import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  WithdrawalDispute,
  WithdrawalDisputeDecision,
  WithdrawalDisputeDocument,
  WithdrawalDisputeReason,
} from './schemas/withdrawal-dispute.schema';
import {
  TicketAssignmentStatus,
  TicketResolutionStatus,
} from '../tickets/schemas/ticket.schema';
import { StaffTeam } from '../staff/schemas/staff-role.schema';
import {
  StaffUser,
  StaffUserDocument,
} from '../staff/schemas/staff-user.schema';
import {
  Withdrawal,
  WithdrawalDocument,
  WithdrawalMethod,
  WithdrawalStatus,
} from '../withdrawals/schemas/withdrawal.schema';
import { UPI_DISPUTE_WINDOW_MS } from '../withdrawals/constants';
import { CreateWithdrawalDisputeDto } from './dto/create-withdrawal-dispute.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationEvent } from '../notifications/notification-events';
import { PayoutBridgeService } from '../payout-bridge/payout-bridge.service';
import { DailyLogger } from '../../common/daily-logger';

// Minimal shape of the uploaded PDF (Multer memory file; avoids @types/multer).
import { User, UserDocument } from '../users/schemas/user.schema';

export interface DisputeUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface WithdrawalDisputeResponse {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  withdrawalId: string;
  reason: WithdrawalDisputeReason;
  title: string;
  description: string;
  amountUsdt: number | null;
  netInr: number | null;
  upiId: string | null;
  utr: string | null;
  bankStatementUrl: string | null;
  bankStatementName: string | null;
  team: StaffTeam;
  assignmentStatus: TicketAssignmentStatus;
  assignee: { id: string; fullName: string; email: string } | null;
  assignedAt: string | null;
  resolutionStatus: TicketResolutionStatus;
  resolutionDecision: WithdrawalDisputeDecision | null;
  resolutionAdjustmentUsd: number;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ListDisputesOptions {
  page?: number;
  limit?: number;
  team?: StaffTeam;
  assignmentStatus?: TicketAssignmentStatus;
  resolutionStatus?: TicketResolutionStatus;
  assigneeId?: string;
  userId?: string;
}

export interface ListDisputesResult {
  items: WithdrawalDisputeResponse[];
  total: number;
  page: number;
  limit: number;
}

export interface StaffViewer {
  id: string;
  isSuperAdmin: boolean;
  team: StaffTeam | null;
}

@Injectable()
export class WithdrawalDisputesService {
  constructor(
    @InjectModel(WithdrawalDispute.name)
    private readonly disputeModel: Model<WithdrawalDisputeDocument>,
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    @InjectModel(StaffUser.name)
    private readonly staffModel: Model<StaffUserDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notifications: NotificationsService,
    private readonly payoutBridge: PayoutBridgeService,
  ) {}

  // ───────── user side ─────────

  async createForUser(
    userId: string,
    dto: CreateWithdrawalDisputeDto,
    file?: DisputeUpload,
    ipAddress?: string,
  ): Promise<WithdrawalDisputeResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    if (!Types.ObjectId.isValid(dto.withdrawalId)) {
      throw new BadRequestException('Invalid withdrawalId');
    }

    const withdrawal = await this.withdrawalModel.findOne({
      _id: new Types.ObjectId(dto.withdrawalId),
      userId: new Types.ObjectId(userId),
    });
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');

    const existingDispute = await this.disputeModel.findOne({
      withdrawalId: withdrawal._id,
    });

    if (withdrawal.disputeRaised || existingDispute) {
      withdrawal.secondDisputeAttempted = true;
      await withdrawal.save();
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'RAISE_SUPPORT_TICKET',
        message:
          'Please raise a ticket from the Profile section and support team will contact you shortly.',
      });
    }

    if (!file || !file.buffer?.length) {
      throw new BadRequestException(
        'A bank-statement PDF is required to raise a dispute',
      );
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('The bank statement must be a PDF');
    }

    const reason = dto.reason ?? WithdrawalDisputeReason.NotReceived;
    let dispute: WithdrawalDisputeDocument;
    try {
      dispute = await this.disputeModel.create({
        userId: new Types.ObjectId(userId),
        withdrawalId: withdrawal._id,
        reason,
        title: this.buildTitle(reason, withdrawal),
        description: dto.description.trim(),
        amountUsdt: withdrawal.amount ?? null,
        netInr: withdrawal.netInr ?? null,
        upiId: withdrawal.upiId ?? null,
        utr: withdrawal.utr ?? null,
        team: StaffTeam.Support,
        assignmentStatus: TicketAssignmentStatus.Unassigned,
        resolutionStatus: TicketResolutionStatus.Pending,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new BadRequestException({
          statusCode: 400,
          errorCode: 'RAISE_SUPPORT_TICKET',
          message:
            'Please raise a ticket from the Profile section and support team will contact you shortly.',
        });
      }
      throw err;
    }

    withdrawal.disputeRaised = true;
    // Raising a dispute moves the transaction back to pending until a super admin
    // approves (→ resolved) or declines (→ paid) it.
    withdrawal.status = WithdrawalStatus.Pending;
    await withdrawal.save();

    // Forward the bank statement + details to the bridge, which stores the PDF
    // (Cloudinary) and posts it into the payout's Telegram group. Bridge-down is
    // handled gracefully — the dispute is already recorded.
    const referenceId =
      withdrawal.smartRef ?? (withdrawal._id as Types.ObjectId).toString();
    const { pdfUrl } = await this.payoutBridge.sendDispute({
      referenceId,
      upiId: withdrawal.upiId ?? '',
      amount: withdrawal.netInr ?? withdrawal.paidInr ?? 0,
      issue: dto.description.trim(),
      disputeId: (dispute._id as Types.ObjectId).toString(),
      file: { buffer: file.buffer, originalname: file.originalname },
    });
    dispute.bankStatementUrl = pdfUrl;
    dispute.bankStatementName = file.originalname;
    await dispute.save();

    const user = await this.userModel.findById(userId);
    const username = user?.serialId || user?.email || (user?._id ? user._id.toString() : 'Unknown');
    const name = user?.name || 'Unknown User';
    const dest =
      withdrawal.method === WithdrawalMethod.Upi
        ? withdrawal.upiId
        : withdrawal.accountNumber
        ? `${withdrawal.bankName || 'Bank'}: ${withdrawal.accountNumber} (${withdrawal.ifscCode || ''})`
        : withdrawal.destinationAddress;

    void DailyLogger.transactionAlert({
      type: 'Withdrawal Dispute',
      status: 'Under Review / Disputed',
      username,
      name,
      amount: `${withdrawal.amount ?? 0} USDT${withdrawal.netInr ? ` (₹${withdrawal.netInr.toLocaleString('en-IN')})` : ''}`,
      ipAddress: ipAddress || '127.0.0.1',
      time: (dispute as any).createdAt || new Date(),
      destinationOrWallet: dest || undefined,
      txIdOrRef: (withdrawal._id as Types.ObjectId).toString(),
      extraDetails: {
        'Dispute ID': (dispute._id as Types.ObjectId).toString(),
        'Reason': dispute.reason || 'Not Received',
        'Issue / Description': dispute.description,
        'Bank Statement': file.originalname || 'Attached PDF',
        ...(dispute.bankStatementUrl ? { 'Statement URL': dispute.bankStatementUrl } : {}),
      },
    });

    void this.notifications.notify(
      withdrawal.userId,
      NotificationEvent.TicketRaised,
      {
        ticketId: (dispute._id as Types.ObjectId).toString(),
        title: dispute.title,
      },
    );

    return this.toResponse(dispute, null);
  }

  async listForUser(
    userId: string,
    limit = 50,
  ): Promise<WithdrawalDisputeResponse[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const docs = await this.disputeModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(safeLimit);
    return this.hydrateMany(docs);
  }

  async getOwnedByUser(
    userId: string,
    disputeId: string,
  ): Promise<WithdrawalDisputeResponse> {
    if (!Types.ObjectId.isValid(disputeId)) {
      throw new BadRequestException('Invalid dispute id');
    }
    const doc = await this.disputeModel.findOne({
      _id: new Types.ObjectId(disputeId),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException('Dispute not found');
    return (await this.hydrateMany([doc]))[0];
  }

  // ───────── staff side ─────────

  async listForStaff(
    viewer: StaffViewer,
    opts: ListDisputesOptions,
  ): Promise<ListDisputesResult> {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

    const filter: FilterQuery<WithdrawalDisputeDocument> = {};
    this.scopeFilterToViewer(filter, viewer, opts.team);

    if (opts.assignmentStatus) filter.assignmentStatus = opts.assignmentStatus;
    if (opts.resolutionStatus) filter.resolutionStatus = opts.resolutionStatus;
    if (opts.assigneeId) {
      if (!Types.ObjectId.isValid(opts.assigneeId)) {
        throw new BadRequestException('Invalid assigneeId');
      }
      filter.assigneeId = new Types.ObjectId(opts.assigneeId);
    }
    if (opts.userId) {
      if (!Types.ObjectId.isValid(opts.userId)) {
        throw new BadRequestException('Invalid userId');
      }
      filter.userId = new Types.ObjectId(opts.userId);
    }

    const [docs, total] = await Promise.all([
      this.disputeModel
        .find(filter)
        .sort({ resolutionStatus: 1, assignmentStatus: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.disputeModel.countDocuments(filter),
    ]);

    return {
      items: await this.hydrateMany(docs),
      total,
      page,
      limit,
    };
  }

  async getForStaff(
    viewer: StaffViewer,
    disputeId: string,
  ): Promise<WithdrawalDisputeResponse> {
    const doc = await this.loadVisibleDispute(viewer, disputeId);
    return (await this.hydrateMany([doc]))[0];
  }

  async assignToMe(
    viewer: StaffViewer,
    disputeId: string,
  ): Promise<WithdrawalDisputeResponse> {
    const doc = await this.loadVisibleDispute(viewer, disputeId);

    if (!viewer.isSuperAdmin && viewer.team !== doc.team) {
      throw new ForbiddenException(
        'You can only pick up disputes for your own team',
      );
    }
    if (doc.resolutionStatus === TicketResolutionStatus.Resolved) {
      throw new BadRequestException(
        'Cannot assign a resolved dispute. Reopen it first.',
      );
    }
    if (doc.assignmentStatus === TicketAssignmentStatus.Assigned) {
      throw new BadRequestException(
        'Dispute is already assigned to someone else',
      );
    }

    doc.assignmentStatus = TicketAssignmentStatus.Assigned;
    doc.assigneeId = new Types.ObjectId(viewer.id);
    doc.assignedAt = new Date();
    await doc.save();
    return (await this.hydrateMany([doc]))[0];
  }

  async transferTeam(
    viewer: StaffViewer,
    disputeId: string,
    target: StaffTeam,
  ): Promise<WithdrawalDisputeResponse> {
    const doc = await this.loadVisibleDispute(viewer, disputeId);

    if (doc.resolutionStatus === TicketResolutionStatus.Resolved) {
      throw new BadRequestException('Cannot transfer a resolved dispute');
    }
    if (doc.team === target) {
      throw new BadRequestException(`Dispute is already on the ${target} team`);
    }
    if (!viewer.isSuperAdmin) {
      if (viewer.team !== doc.team) {
        throw new ForbiddenException(
          'You can only transfer disputes for your own team',
        );
      }
      if (!doc.assigneeId || doc.assigneeId.toString() !== viewer.id) {
        throw new ForbiddenException(
          'Only the current assignee can transfer this dispute',
        );
      }
    }

    doc.team = target;
    doc.assignmentStatus = TicketAssignmentStatus.Unassigned;
    doc.assigneeId = null;
    doc.assignedAt = null;
    await doc.save();
    return (await this.hydrateMany([doc]))[0];
  }

  // Close (resolve) a dispute — the staff-facing equivalent of resolving a
  // ticket.
  async resolve(
    viewer: StaffViewer,
    disputeId: string,
    resolutionNotes?: string,
  ): Promise<WithdrawalDisputeResponse> {
    const doc = await this.loadVisibleDispute(viewer, disputeId);

    if (doc.resolutionStatus === TicketResolutionStatus.Resolved) {
      throw new BadRequestException('Dispute is already resolved');
    }
    if (doc.assignmentStatus !== TicketAssignmentStatus.Assigned) {
      throw new BadRequestException(
        'Assign the dispute to someone before resolving it',
      );
    }
    if (!viewer.isSuperAdmin) {
      if (!doc.assigneeId || doc.assigneeId.toString() !== viewer.id) {
        throw new ForbiddenException(
          'Only the current assignee can resolve this dispute',
        );
      }
    }

    doc.resolutionStatus = TicketResolutionStatus.Resolved;
    doc.resolvedAt = new Date();
    doc.resolvedBy = new Types.ObjectId(viewer.id);
    if (resolutionNotes !== undefined) {
      doc.resolutionNotes = resolutionNotes.trim() || null;
    }
    await doc.save();

    void this.notifications.notify(
      doc.userId,
      NotificationEvent.TicketResolved,
      {
        ticketId: (doc._id as Types.ObjectId).toString(),
        title: doc.title,
      },
    );
    return (await this.hydrateMany([doc]))[0];
  }

  // Super admin APPROVES a dispute (user was right): apply a credit/debit to the
  // user's balance (USDT) and move the transaction pending → resolved.
  async approveDispute(
    viewer: StaffViewer,
    disputeId: string,
    params: {
      amountUsdt: number;
      direction: 'credit' | 'debit';
      resolutionNotes?: string;
    },
  ): Promise<WithdrawalDisputeResponse> {
    const doc = await this.loadVisibleDispute(viewer, disputeId);
    if (!viewer.isSuperAdmin) {
      throw new ForbiddenException('Only a super admin can approve a dispute');
    }
    if (doc.resolutionStatus === TicketResolutionStatus.Resolved) {
      throw new BadRequestException('Dispute is already resolved');
    }

    const withdrawal = await this.withdrawalModel.findById(doc.withdrawalId);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== WithdrawalStatus.Pending) {
      throw new BadRequestException(
        'This transaction is not awaiting dispute resolution',
      );
    }

    // Signed adjustment: +credit adds to available balance, -debit removes.
    const signed =
      params.direction === 'credit' ? params.amountUsdt : -params.amountUsdt;
    withdrawal.balanceAdjustmentUsd =
      (withdrawal.balanceAdjustmentUsd ?? 0) + signed;
    withdrawal.status = WithdrawalStatus.Resolved;
    await withdrawal.save();

    doc.resolutionStatus = TicketResolutionStatus.Resolved;
    doc.resolutionDecision = WithdrawalDisputeDecision.Approved;
    doc.resolutionAdjustmentUsd = signed;
    doc.resolvedAt = new Date();
    doc.resolvedBy = new Types.ObjectId(viewer.id);
    if (params.resolutionNotes !== undefined) {
      doc.resolutionNotes = params.resolutionNotes.trim() || null;
    }
    await doc.save();

    const user = await this.userModel.findById(doc.userId);
    const username = user?.serialId || user?.email || (user?._id ? user._id.toString() : 'Unknown');
    const name = user?.name || 'Unknown User';
    void DailyLogger.transactionAlert({
      type: 'Withdrawal Dispute',
      status: 'Approved / Resolved',
      username,
      name,
      amount: `${params.amountUsdt} USDT (${params.direction})`,
      time: new Date(),
      txIdOrRef: (withdrawal._id as Types.ObjectId).toString(),
      extraDetails: {
        'Dispute ID': (doc._id as Types.ObjectId).toString(),
        'Decision': `Dispute Approved (${params.direction} ${params.amountUsdt} USDT)`,
        'Resolved By Admin': viewer.id,
        ...(params.resolutionNotes ? { 'Notes': params.resolutionNotes } : {}),
      },
    });

    void this.notifications.notify(doc.userId, NotificationEvent.TicketResolved, {
      ticketId: (doc._id as Types.ObjectId).toString(),
      title: doc.title,
    });
    return (await this.hydrateMany([doc]))[0];
  }

  // Super admin DECLINES a dispute (it was false): no balance change, and the
  // transaction returns pending → paid (shown as successful).
  async declineDispute(
    viewer: StaffViewer,
    disputeId: string,
    resolutionNotes?: string,
  ): Promise<WithdrawalDisputeResponse> {
    const doc = await this.loadVisibleDispute(viewer, disputeId);
    if (!viewer.isSuperAdmin) {
      throw new ForbiddenException('Only a super admin can decline a dispute');
    }
    if (doc.resolutionStatus === TicketResolutionStatus.Resolved) {
      throw new BadRequestException('Dispute is already resolved');
    }

    const withdrawal = await this.withdrawalModel.findById(doc.withdrawalId);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (withdrawal.status !== WithdrawalStatus.Pending) {
      throw new BadRequestException(
        'This transaction is not awaiting dispute resolution',
      );
    }

    withdrawal.status = WithdrawalStatus.Paid; // back to successful, no change
    await withdrawal.save();

    doc.resolutionStatus = TicketResolutionStatus.Resolved;
    doc.resolutionDecision = WithdrawalDisputeDecision.Declined;
    doc.resolutionAdjustmentUsd = 0;
    doc.resolvedAt = new Date();
    doc.resolvedBy = new Types.ObjectId(viewer.id);
    if (resolutionNotes !== undefined) {
      doc.resolutionNotes = resolutionNotes.trim() || null;
    }
    await doc.save();

    const user = await this.userModel.findById(doc.userId);
    const username = user?.serialId || user?.email || (user?._id ? user._id.toString() : 'Unknown');
    const name = user?.name || 'Unknown User';
    void DailyLogger.transactionAlert({
      type: 'Withdrawal Dispute',
      status: 'Declined / Paid',
      username,
      name,
      amount: `${withdrawal.amount ?? 0} USDT`,
      time: new Date(),
      txIdOrRef: (withdrawal._id as Types.ObjectId).toString(),
      extraDetails: {
        'Dispute ID': (doc._id as Types.ObjectId).toString(),
        'Decision': 'Dispute Declined (Transaction restored to Paid)',
        'Resolved By Admin': viewer.id,
        ...(resolutionNotes ? { 'Notes': resolutionNotes } : {}),
      },
    });

    void this.notifications.notify(doc.userId, NotificationEvent.TicketResolved, {
      ticketId: (doc._id as Types.ObjectId).toString(),
      title: doc.title,
    });
    return (await this.hydrateMany([doc]))[0];
  }

  // ───────── helpers ─────────

  private buildTitle(
    reason: WithdrawalDisputeReason,
    withdrawal: WithdrawalDocument,
  ): string {
    const amount =
      withdrawal.netInr != null
        ? `₹${withdrawal.netInr}`
        : `${withdrawal.amount} USDT`;
    switch (reason) {
      case WithdrawalDisputeReason.WrongAmount:
        return `UPI withdrawal — wrong amount received (${amount})`;
      case WithdrawalDisputeReason.Other:
        return `UPI withdrawal — payment issue (${amount})`;
      case WithdrawalDisputeReason.NotReceived:
      default:
        return `UPI withdrawal not received (${amount})`;
    }
  }

  private async loadVisibleDispute(
    viewer: StaffViewer,
    disputeId: string,
  ): Promise<WithdrawalDisputeDocument> {
    if (!Types.ObjectId.isValid(disputeId)) {
      throw new BadRequestException('Invalid dispute id');
    }
    const doc = await this.disputeModel.findById(disputeId);
    if (!doc) throw new NotFoundException('Dispute not found');

    if (!viewer.isSuperAdmin) {
      if (!viewer.team) {
        throw new ForbiddenException(
          'Your role has no team. Ask a super admin to assign your role to support or tech.',
        );
      }
      if (viewer.team !== doc.team) {
        throw new ForbiddenException(
          'This dispute belongs to a different team',
        );
      }
    }
    return doc;
  }

  private scopeFilterToViewer(
    filter: FilterQuery<WithdrawalDisputeDocument>,
    viewer: StaffViewer,
    explicitTeam: StaffTeam | undefined,
  ): void {
    if (viewer.isSuperAdmin) {
      if (explicitTeam) filter.team = explicitTeam;
      return;
    }
    if (!viewer.team) {
      // Force an empty result set for staff with no team.
      filter.team = '__no_team__' as unknown as StaffTeam;
      return;
    }
    filter.team = viewer.team;
  }

  private async hydrateMany(
    docs: WithdrawalDisputeDocument[],
  ): Promise<WithdrawalDisputeResponse[]> {
    const assigneeIds = Array.from(
      new Set(
        docs
          .map((d) => d.assigneeId?.toString())
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const userIds = Array.from(
      new Set(
        docs
          .map((d) => d.userId?.toString())
          .filter((v): v is string => Boolean(v) && typeof v === 'string' && Types.ObjectId.isValid(v)),
      ),
    );

    const [assignees, users] = await Promise.all([
      assigneeIds.length
        ? this.staffModel
            .find({ _id: { $in: assigneeIds.map((id) => new Types.ObjectId(id)) } })
            .select('fullName email')
            .exec()
        : [],
      userIds.length
        ? this.userModel
            .find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } })
            .select('name email')
            .exec()
        : [],
    ]);

    const assigneeMap = new Map<
      string,
      { id: string; fullName: string; email: string }
    >();
    (assignees as any[]).forEach((a) =>
      assigneeMap.set((a._id as Types.ObjectId).toString(), {
        id: (a._id as Types.ObjectId).toString(),
        fullName: a.fullName,
        email: a.email,
      }),
    );

    const userMap = new Map<string, { name: string; email: string }>();
    (users as any[]).forEach((u) =>
      userMap.set((u._id as Types.ObjectId).toString(), {
        name: u.name || u.email,
        email: u.email,
      }),
    );

    return docs.map((d) =>
      this.toResponse(
        d,
        d.assigneeId ? assigneeMap.get(d.assigneeId.toString()) ?? null : null,
        userMap.get(d.userId.toString()) ?? null,
      ),
    );
  }

  private toResponse(
    doc: WithdrawalDisputeDocument,
    assignee: { id: string; fullName: string; email: string } | null,
    userInfo?: { name: string; email: string } | null,
  ): WithdrawalDisputeResponse {
    const ts = doc as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (doc._id as Types.ObjectId).toString(),
      userId: doc.userId.toString(),
      userName: userInfo?.name,
      userEmail: userInfo?.email,
      withdrawalId: doc.withdrawalId.toString(),
      reason: doc.reason,
      title: doc.title,
      description: doc.description,
      amountUsdt: doc.amountUsdt ?? null,
      netInr: doc.netInr ?? null,
      upiId: doc.upiId ?? null,
      utr: doc.utr ?? null,
      bankStatementUrl: doc.bankStatementUrl ?? null,
      bankStatementName: doc.bankStatementName ?? null,
      team: doc.team,
      assignmentStatus: doc.assignmentStatus,
      assignee,
      assignedAt: doc.assignedAt ? doc.assignedAt.toISOString() : null,
      resolutionStatus: doc.resolutionStatus,
      resolutionDecision: doc.resolutionDecision ?? null,
      resolutionAdjustmentUsd: doc.resolutionAdjustmentUsd ?? 0,
      resolvedAt: doc.resolvedAt ? doc.resolvedAt.toISOString() : null,
      resolvedBy: doc.resolvedBy ? doc.resolvedBy.toString() : null,
      resolutionNotes: doc.resolutionNotes ?? null,
      createdAt: ts.createdAt ? ts.createdAt.toISOString() : null,
      updatedAt: ts.updatedAt ? ts.updatedAt.toISOString() : null,
    };
  }
}

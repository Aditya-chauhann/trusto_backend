import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DailyLogger } from '../../common/daily-logger';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Withdrawal,
  WithdrawalDocument,
  WithdrawalMethod,
  WithdrawalStatus,
} from './schemas/withdrawal.schema';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { CreateUpiRequestDto } from './dto/create-upi-request.dto';
import { DepositsService } from '../deposits/deposits.service';
import { BankAccountsService } from './bank-accounts.service';
import { UpiAccountsService } from './upi-accounts.service';
import { SmartLiquidationService } from './smart-liquidation.service';
import { IpActivityService } from '../ip-activity/ip-activity.service';
import { PricingService } from '../pricing/pricing.service';
import { SystemControlsService } from '../system-controls/system-controls.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationEvent } from '../notifications/notification-events';
import { WithdrawalPinService } from '../withdrawal-pin/withdrawal-pin.service';
import { PayoutBridgeService } from '../payout-bridge/payout-bridge.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PayoutPaidCallbackDto } from '../payout-bridge/dto/payout-paid-callback.dto';
import { PayoutMatchedCallbackDto } from '../payout-bridge/dto/payout-matched-callback.dto';
import {
  SmartReservationDocument,
  SmartReservationStatus,
} from './schemas/smart-reservation.schema';
import {
  SMART_DECLINE_WINDOW_MS,
  UPI_DISPUTE_WINDOW_MS,
  WITHDRAWAL_MIN_USDT,
  round2,
} from './constants';

import {
  WithdrawalDispute,
  WithdrawalDisputeDecision,
  WithdrawalDisputeDocument,
} from '../withdrawal-disputes/schemas/withdrawal-dispute.schema';
import { TicketResolutionStatus } from '../tickets/schemas/ticket.schema';

export interface WithdrawalResponse {
  id: string;
  userId: string;
  method: WithdrawalMethod;
  amount: number;
  feeRate: number;
  fxRate: number;
  feeUsdt: number;
  netUsdt: number;
  grossInr: number | null;
  feeInr: number | null;
  netInr: number | null;
  bankName: string | null;
  accountNumber: string | null;
  ifscCode: string | null;
  accountHolderName: string | null;
  upiId: string | null;
  network: string | null;
  destinationAddress: string | null;
  status: WithdrawalStatus;
  txHash: string | null;
  utr: string | null;
  notes: string | null;
  processedBy: string | null;
  processedAt: string | null;
  decisionReason: string | null;
  disputeRaised: boolean;
  disputeDetails?: {
    id: string;
    reason: string;
    description: string;
    bankStatementUrl: string | null;
    bankStatementName: string | null;
    resolutionStatus: string;
    resolutionDecision: string | null;
    resolutionNotes?: string | null;
    resolvedAt?: string | null;
    createdAt: string;
  } | null;
  paymentProofUrl: string | null;
  blurredProofUrl: string | null;
  paidInr: number | null;
  differenceInr: number | null;
  balanceAdjustmentUsd: number;
  overpaidBy: number | null;
  screenshotAmountInr: number | null;
  isSmart: boolean;
  disputeWindowExpiresAt: string | null;
  declineWindowExpiresAt: string | null;
  userConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(WithdrawalDispute.name)
    private readonly disputeModel: Model<WithdrawalDisputeDocument>,
    private readonly depositsService: DepositsService,
    private readonly bankAccountsService: BankAccountsService,
    private readonly upiAccountsService: UpiAccountsService,
    private readonly pricingService: PricingService,
    private readonly systemControlsService: SystemControlsService,
    private readonly notifications: NotificationsService,
    private readonly withdrawalPin: WithdrawalPinService,
    private readonly payoutBridge: PayoutBridgeService,
    private readonly realtime: RealtimeGateway,
    private readonly smartLiquidation: SmartLiquidationService,
    private readonly ipActivityService: IpActivityService,
  ) {}

  async createFromUpiRequest(userId: string, dto: CreateUpiRequestDto, ip?: string) {
    const pricing = await this.pricingService.getEffectiveForUser(userId);
    const rate = pricing.upiInrPrice ?? pricing.inrPrice;
    if (!rate || rate <= 0) {
      throw new BadRequestException('Invalid UPI exchange rate');
    }
    const minUsdt = await this.pricingService.getSmartToggleMinUsdt();
    const amountUsdt = round2(dto.inrAmount / rate);
    if (amountUsdt < minUsdt) {
      const minInr = round2(minUsdt * rate);
      throw new BadRequestException(
        `Minimum payment is ₹${minInr.toLocaleString('en-IN')}`,
      );
    }

    const notes = [
      dto.payeeName ? `Payee: ${dto.payeeName}` : null,
      dto.qrPayload ? 'UPI QR payment' : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return this.create(userId, {
      pin: dto.pin,
      method: WithdrawalMethod.Upi,
      amount: amountUsdt,
      upiId: dto.upiId.trim().toLowerCase(),
      notes: notes || undefined,
    }, ip);
  }

  async create(
    userId: string,
    dto: CreateWithdrawalDto,
    ip?: string,
  ): Promise<WithdrawalResponse> {
    await this.withdrawalPin.verifyPinForWithdrawal(userId, dto.pin);

    const controls = await this.systemControlsService.getPublic();
    if (!controls.withdrawalsEnabled) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'WITHDRAWALS_DISABLED',
        message:
          controls.withdrawalsDisabledReason ||
          'Withdrawals are temporarily disabled. Please try again later.',
      });
    }

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.isBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'ACCOUNT_BLOCKED',
        message: 'Your account has been blocked. Please contact support.',
        reason: user.blockedReason ?? null,
      });
    }
    if (user.isFrozen) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'ACCOUNT_FROZEN',
        message: 'Your account is frozen. Withdrawals are disabled.',
        reason: user.frozenReason ?? null,
      });
    }
    // While Smart auto-liquidation is on, the balance is reserved for the pool —
    // manual withdrawals are disabled (the UI hides the button too).
    if (user.smartUpiSelectionEnabled) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'SMART_LIQUIDATION_ACTIVE',
        message:
          'Turn off Smart auto-liquidation to make a manual withdrawal.',
      });
    }

    const minUsdt = await this.pricingService.getSmartToggleMinUsdt();
    if (dto.amount < minUsdt) {
      throw new BadRequestException(
        `Minimum withdrawal is ${minUsdt} USDT`,
      );
    }

    const totalDeposits =
      await this.depositsService.sumUserVisibleDepositsFor(userId);
    const locked = await this.sumLockedFor(userId);
    const available = round2(totalDeposits - locked);
    if (dto.amount > available) {
      throw new BadRequestException(
        `Insufficient balance. Available: ${available.toFixed(2)} USDT`,
      );
    }

    const pricing = await this.pricingService.getEffectiveForUser(userId);
    const feeRate =
      dto.method === WithdrawalMethod.Bank
        ? (pricing.bankFee ?? 0)
        : dto.method === WithdrawalMethod.Upi
          ? (pricing.feePercent ?? 0)
          : (pricing.cryptoFee ?? 0);
    const fxRate =
      dto.method === WithdrawalMethod.Upi
        ? (pricing.upiInrPrice ?? pricing.inrPrice)
        : pricing.inrPrice;
    const feeUsdt = round2(dto.amount * feeRate);
    const netUsdt = round2(dto.amount - feeUsdt);

    const base: Partial<Withdrawal> = {
      userId: new Types.ObjectId(userId),
      method: dto.method,
      amount: dto.amount,
      feeRate,
      fxRate,
      feeUsdt,
      netUsdt,
      status: WithdrawalStatus.Pending,
      notes: dto.notes,
    };

    if (dto.method === WithdrawalMethod.Bank) {
      let accountNumber = dto.accountNumber;
      let ifscCode = dto.ifscCode;
      let bankName = dto.bankName;
      let accountHolderName = dto.accountHolderName;
      if (dto.bankAccountId) {
        const saved = await this.bankAccountsService.getOwnedById(
          userId,
          dto.bankAccountId,
          { requireApproved: true },
        );
        accountNumber = saved.accountNumber;
        ifscCode = saved.ifscCode;
        bankName = saved.bankName ?? bankName;
        accountHolderName = saved.accountHolderName ?? accountHolderName;
      }
      if (!accountHolderName) {
        accountHolderName = user.name || undefined;
      }

      const grossInr = round2(dto.amount * pricing.inrPrice);
      const feeInr = round2(grossInr * feeRate);
      const netInr = round2(grossInr - feeInr);
      Object.assign(base, {
        grossInr,
        feeInr,
        netInr,
        bankName,
        accountNumber,
        ifscCode,
        accountHolderName,
      });
    } else if (dto.method === WithdrawalMethod.Upi) {
      const upiDetails = await this.upiAccountsService.resolveWithdrawalUpiDetails(
        userId,
        { upiAccountId: dto.upiAccountId, upiId: dto.upiId },
      );
      const upiId = upiDetails.upiId;

      const grossInr = round2(dto.amount * fxRate);
      const feeInr = round2(grossInr * feeRate);
      const netInr = round2(grossInr - feeInr);
      Object.assign(base, {
        fxRate,
        grossInr,
        feeInr,
        netInr,
        upiId,
        accountHolderName: upiDetails.accountHolderName || user.name || undefined,
      });
    } else {
      Object.assign(base, {
        network: dto.network,
        destinationAddress: dto.destinationAddress,
      });
    }

    const created = await this.withdrawalModel.create(base);
    if (ip) {
      void this.ipActivityService.log({
        userId: created.userId,
        email: user.email,
        phone: user.phone,
        actionType: 'withdrawal',
        ipAddress: ip,
        details: {
          withdrawalId: (created._id as Types.ObjectId).toString(),
          amount: created.amount.toString(),
          method: created.method,
        },
      }).catch(() => {});
    }
    DailyLogger.log(`Withdrawal created successfully: id=${created._id}, userId=${created.userId}, amount=${created.amount} USDT, method=${created.method}`, 'WithdrawalsService');

    const username = user?.serialId || user?.email || (user?._id ? user._id.toString() : 'Unknown');
    const name = user?.name || 'Unknown User';
    const dest =
      created.method === WithdrawalMethod.Upi
        ? created.upiId
        : `${created.bankName || 'Bank'}: ${created.accountNumber || ''} (${created.ifscCode || ''})`;

    void DailyLogger.transactionAlert({
      type: 'Withdrawal',
      status: created.status || 'Pending',
      username,
      name,
      amount: `${created.amount} USDT${created.netInr ? ` (₹${created.netInr.toLocaleString('en-IN')})` : ''}`,
      ipAddress: ip || '127.0.0.1',
      time: (created as any).createdAt || new Date(),
      destinationOrWallet: dest || undefined,
      txIdOrRef: (created._id as Types.ObjectId).toString(),
      extraDetails: {
        'Method': created.method.toUpperCase(),
        ...(created.feeUsdt ? { 'Fee': `${created.feeUsdt} USDT` } : {}),
      },
    });

    void this.notifications.notify(
      created.userId,
      NotificationEvent.WithdrawalRequested,
      { amount: created.amount, method: created.method },
    );

    // For Bank transfers, submit payout to Central Payout Management (CPM)
    if (
      created.method === WithdrawalMethod.Bank &&
      created.netInr != null &&
      created.accountNumber &&
      created.ifscCode
    ) {
      void this.payoutBridge.submitCpmPayout({
        referenceId: (created._id as Types.ObjectId).toString(),
        amount: created.netInr,
        payee: {
          name: (base as any).accountHolderName || user.name || 'Account Holder',
          accountNumber: created.accountNumber,
          ifsc: created.ifscCode,
          bankName: created.bankName || 'Bank Transfer',
        },
      });
    }

    // For UPI, hand the request to the payout-bridge so it gets announced in the
    // Telegram group. The amount an LP must pay is the net INR the user receives.
    if (
      created.method === WithdrawalMethod.Upi &&
      created.upiId &&
      created.netInr != null
    ) {
      void this.payoutBridge.registerPayoutRequest({
        referenceId: (created._id as Types.ObjectId).toString(),
        amount: created.netInr,
        upiId: created.upiId,
        accountHolderName: (base as any).accountHolderName ?? undefined,
      });
    }

    return this.toResponse(created);
  }

  async listForUser(
    userId: string,
    limit = 50,
  ): Promise<WithdrawalResponse[]> {
    const docs = await this.withdrawalModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit);

    const withdrawalIds = docs.map((d) => d._id);
    const disputes = await this.disputeModel.find({
      withdrawalId: { $in: withdrawalIds },
    });
    const disputeMap = new Map(
      disputes.map((dp) => [dp.withdrawalId.toString(), dp]),
    );

    return docs.map((d) => {
      const resp = this.toResponse(d);
      const dp = disputeMap.get((d._id as Types.ObjectId).toString());
      if (dp) {
        const isProcessed =
          d.status === WithdrawalStatus.Paid ||
          d.status === WithdrawalStatus.Failed ||
          d.status === WithdrawalStatus.Resolved ||
          dp.resolutionStatus === TicketResolutionStatus.Resolved;
        if (isProcessed) {
          resp.disputeRaised = false;
        }
        resp.disputeDetails = {
          id: (dp._id as Types.ObjectId).toString(),
          reason: dp.reason,
          description: dp.description,
          bankStatementUrl: dp.bankStatementUrl ?? null,
          bankStatementName: dp.bankStatementName ?? null,
          resolutionStatus: isProcessed
            ? TicketResolutionStatus.Resolved
            : dp.resolutionStatus,
          resolutionDecision:
            dp.resolutionDecision ??
            (d.status === WithdrawalStatus.Paid ? 'declined' : 'approved'),
          resolutionNotes:
            dp.resolutionNotes ??
            d.decisionReason ??
            (d.status === WithdrawalStatus.Paid
              ? 'Payment verified and completed by admin.'
              : 'Dispute reviewed and resolved by admin.'),
          resolvedAt: dp.resolvedAt
            ? dp.resolvedAt.toISOString()
            : isProcessed && d.processedAt
            ? d.processedAt.toISOString()
            : null,
          createdAt: (dp as any).createdAt
            ? (dp as any).createdAt.toISOString()
            : '',
        };
      }
      return resp;
    });
  }

  // Only the user's Smart auto-liquidation payouts (matched/awaiting, paid, or
  // declined) — for the dedicated Smart screen.
  async listSmartForUser(
    userId: string,
    limit = 50,
  ): Promise<WithdrawalResponse[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const docs = await this.withdrawalModel
      .find({ userId: new Types.ObjectId(userId), isSmart: true })
      .sort({ createdAt: -1 })
      .limit(limit);
    return docs.map((d) => this.toResponse(d));
  }

  async listAllForAdmin(opts: {
    page?: number;
    limit?: number;
    userId?: string;
    status?: WithdrawalStatus;
    method?: WithdrawalMethod;
  } = {}): Promise<{
    items: WithdrawalResponse[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);

    const filter: FilterQuery<WithdrawalDocument> = {};
    if (opts.userId) {
      if (!Types.ObjectId.isValid(opts.userId)) {
        throw new BadRequestException('Invalid userId');
      }
      filter.userId = new Types.ObjectId(opts.userId);
    }
    if (opts.status) filter.status = opts.status;
    if (opts.method) filter.method = opts.method;

    const [docs, total] = await Promise.all([
      this.withdrawalModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.withdrawalModel.countDocuments(filter),
    ]);

    const withdrawalIds = docs.map((d) => d._id);
    const userIds = Array.from(new Set(docs.map((d) => d.userId).filter(Boolean)));
    const [disputes, users] = await Promise.all([
      this.disputeModel.find({ withdrawalId: { $in: withdrawalIds } }),
      this.userModel.find({ _id: { $in: userIds } }).select('_id serialId name email phone'),
    ]);
    const disputeMap = new Map(
      disputes.map((dp) => [dp.withdrawalId.toString(), dp]),
    );
    const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

    const items = docs.map((d) => {
      const resp = this.toResponse(d);
      const u = userMap.get(d.userId.toString());
      if (u) {
        (resp as any).serialId = u.serialId || null;
        (resp as any).userName = u.name || null;
        (resp as any).userEmail = u.email || null;
        (resp as any).userPhone = u.phone || null;
      }
      if (!resp.accountHolderName && (d.method === WithdrawalMethod.Bank || d.method === WithdrawalMethod.Upi)) {
        resp.accountHolderName = u?.name || null;
      }
      const dp = disputeMap.get((d._id as Types.ObjectId).toString());
      if (dp) {
        const isProcessed =
          d.status === WithdrawalStatus.Paid ||
          d.status === WithdrawalStatus.Failed ||
          d.status === WithdrawalStatus.Resolved ||
          dp.resolutionStatus === TicketResolutionStatus.Resolved;
        if (isProcessed) {
          resp.disputeRaised = false;
        }
        resp.disputeDetails = {
          id: (dp._id as Types.ObjectId).toString(),
          reason: dp.reason,
          description: dp.description,
          bankStatementUrl: dp.bankStatementUrl ?? null,
          bankStatementName: dp.bankStatementName ?? null,
          resolutionStatus: isProcessed
            ? TicketResolutionStatus.Resolved
            : dp.resolutionStatus,
          resolutionDecision:
            dp.resolutionDecision ??
            (d.status === WithdrawalStatus.Paid ? 'declined' : 'approved'),
          resolutionNotes:
            dp.resolutionNotes ??
            d.decisionReason ??
            (d.status === WithdrawalStatus.Paid
              ? 'Payment verified and completed by admin.'
              : 'Dispute reviewed and resolved by admin.'),
          resolvedAt: dp.resolvedAt
            ? dp.resolvedAt.toISOString()
            : isProcessed && d.processedAt
            ? d.processedAt.toISOString()
            : null,
          createdAt: (dp as any).createdAt
            ? (dp as any).createdAt.toISOString()
            : '',
        };
      }
      return resp;
    });

    return {
      items,
      total,
      page,
      limit,
    };
  }

  async approve(
    withdrawalId: string,
    adminId: string,
    reason: string,
    txHash?: string,
    utr?: string,
  ): Promise<WithdrawalResponse> {
    const doc = await this.findPendingOrFail(withdrawalId);

    let isNowPaid = false;
    if (
      doc.method === WithdrawalMethod.Bank ||
      doc.method === WithdrawalMethod.Upi
    ) {
      if (!utr || utr.trim().length === 0) {
        throw new BadRequestException(
          `UTR is required to approve a ${doc.method} withdrawal`,
        );
      }
      doc.status = WithdrawalStatus.Paid;
      if (utr) doc.utr = utr.trim().toUpperCase();
      isNowPaid = true;
    } else if (doc.method === WithdrawalMethod.Crypto) {
      const cleanTxHash = txHash?.trim();
      if (cleanTxHash) {
        doc.status = WithdrawalStatus.Paid;
        doc.txHash = cleanTxHash;
        isNowPaid = true;
      } else {
        if (doc.status === WithdrawalStatus.Processing) {
          throw new BadRequestException('Already holding');
        }
        // Admin accepted the pending crypto request: money STILL remains in hold until successful transaction
        doc.status = WithdrawalStatus.Processing;
        isNowPaid = false;
      }
    }

    doc.processedBy = new Types.ObjectId(adminId);
    doc.processedAt = new Date();
    doc.decisionReason = reason;

    if (isNowPaid) {
      doc.disputeWindowExpiresAt = new Date(doc.processedAt.getTime() + UPI_DISPUTE_WINDOW_MS);
    }

    if (doc.disputeRaised) {
      doc.disputeRaised = false;
      const dp = await this.disputeModel.findOne({ withdrawalId: doc._id });
      if (dp) {
        dp.resolutionStatus = TicketResolutionStatus.Resolved;
        dp.resolutionDecision = isNowPaid
          ? WithdrawalDisputeDecision.Approved
          : WithdrawalDisputeDecision.Declined;
        dp.resolutionNotes = reason;
        dp.resolvedAt = new Date();
        await dp.save();
      }
    }

    await doc.save();

    if (isNowPaid) {
      void this.userModel.findById(doc.userId).select('name email serialId').then((u) => {
        if (u) {
          void DailyLogger.transactionAlert({
            type: 'Withdrawal',
            status: 'Approved / Paid',
            username: u.serialId || u.email || doc.userId.toString(),
            name: u.name || 'User',
            amount: `${doc.amount} USDT${doc.netInr ? ` (₹${doc.netInr.toLocaleString('en-IN')})` : ''}`,
            time: new Date(),
            destinationOrWallet: doc.upiId || (doc.accountNumber ? `${doc.bankName || 'Bank'}: ${doc.accountNumber}` : doc.destinationAddress || undefined),
            txIdOrRef: doc.utr || doc.txHash || (doc._id as Types.ObjectId).toString(),
            extraDetails: {
              'Action': 'Approved by Admin (Paid)',
              ...(doc.utr ? { 'UTR': doc.utr } : {}),
              ...(doc.txHash ? { 'Tx Hash': doc.txHash } : {}),
            },
          });
        }
      });

      void this.notifications.notify(
        doc.userId,
        NotificationEvent.WithdrawalApproved,
        {
          amount: doc.amount,
          method: doc.method,
          utr: doc.utr ?? null,
          txHash: doc.txHash ?? null,
        },
      );
    } else {
      void this.userModel.findById(doc.userId).select('name email serialId').then((u) => {
        if (u) {
          void DailyLogger.transactionAlert({
            type: 'Withdrawal',
            status: 'Accepted (On Hold / Processing)',
            username: u.serialId || u.email || doc.userId.toString(),
            name: u.name || 'User',
            amount: `${doc.amount} USDT`,
            time: new Date(),
            destinationOrWallet: doc.destinationAddress || undefined,
            txIdOrRef: (doc._id as Types.ObjectId).toString(),
            extraDetails: {
              'Action': 'Request Accepted by Admin — Held in Processing',
              'Reason': reason,
            },
          });
        }
      });
    }

    return this.toResponse(doc);
  }

  async reject(
    withdrawalId: string,
    adminId: string,
    reason: string,
  ): Promise<WithdrawalResponse> {
    const doc = await this.findPendingOrFail(withdrawalId);
    doc.status = WithdrawalStatus.Failed;
    doc.processedBy = new Types.ObjectId(adminId);
    doc.processedAt = new Date();
    doc.decisionReason = reason;

    if (doc.disputeRaised) {
      doc.disputeRaised = false;
      const dp = await this.disputeModel.findOne({ withdrawalId: doc._id });
      if (dp) {
        dp.resolutionStatus = TicketResolutionStatus.Resolved;
        dp.resolutionDecision = WithdrawalDisputeDecision.Declined;
        dp.resolutionNotes = reason;
        dp.resolvedAt = new Date();
        await dp.save();
      }
    }

    if (doc.isSmart && doc.smartRef) {
      try {
        await this.payoutBridge.userDeclinePayoutRequest(doc.smartRef);
        await this.smartLiquidation.markReservationCancelled(doc.smartRef);
      } catch (err) {
        this.logger.warn(`Failed to cancel smart reservation on admin reject: ${err}`);
      }
    }

    await doc.save();

    void this.userModel.findById(doc.userId).select('name email serialId').then((u) => {
      if (u) {
        void DailyLogger.transactionAlert({
          type: 'Withdrawal',
          status: 'Rejected / Failed',
          username: u.serialId || u.email || doc.userId.toString(),
          name: u.name || 'User',
          amount: `${doc.amount} USDT`,
          time: new Date(),
          txIdOrRef: (doc._id as Types.ObjectId).toString(),
          extraDetails: {
            'Reason': reason || 'Rejected by Admin',
          },
        });
      }
    });

    void this.notifications.notify(
      doc.userId,
      NotificationEvent.WithdrawalRejected,
      { amount: doc.amount, reason },
    );
    return this.toResponse(doc);
  }

  /**
   * Called by the payout-bridge callback when a screenshot is matched to this
   * UPI withdrawal. Marks it paid, stores the proof screenshot, and pushes a
   * live event so the user's app opens the dispute modal immediately.
   * Idempotent: a duplicate callback for an already-paid withdrawal is a no-op.
   */
  async markPaidFromProof(
    payload: PayoutPaidCallbackDto,
  ): Promise<WithdrawalResponse> {
    // ---- Smart auto-liquidation fill ----
    // For smart requests the bridge's referenceId is a RESERVATION ref stored on
    // a User (not a withdrawal id). The withdrawal is created HERE, on the fill —
    // never on arm/reserve — so transactions only ever represent real payouts.
    // Idempotent: a duplicate callback returns the already-created fill.
    const paidSmart = await this.withdrawalModel.findOne({
      smartRef: payload.referenceId,
      status: WithdrawalStatus.Paid,
    });
    if (paidSmart) return this.toResponse(paidSmart); // idempotent duplicate
    const reservation =
      await this.smartLiquidation.findByReferenceIdIncludingLegacy(
        payload.referenceId,
      );
    if (
      reservation &&
      (reservation.status === SmartReservationStatus.Held ||
        reservation.status === SmartReservationStatus.Matched)
    ) {
      return this.settleSmartFill(reservation, payload);
    }

    // ---- Manual UPI withdrawal path ----
    if (!Types.ObjectId.isValid(payload.referenceId)) {
      throw new BadRequestException('Invalid referenceId');
    }
    const doc = await this.withdrawalModel.findById(payload.referenceId);
    if (!doc) throw new NotFoundException('Withdrawal not found');
    if (doc.method !== WithdrawalMethod.Upi) {
      throw new BadRequestException('Withdrawal is not a UPI withdrawal');
    }

    // Idempotency: already settled — return current state without re-firing.
    if (doc.status === WithdrawalStatus.Paid) {
      return this.toResponse(doc);
    }

    const extractedUtr =
      typeof payload.extracted?.utr === 'string' ? payload.extracted.utr : null;

    // Settlement: the buyer may have paid more/less than requested (within the
    // bridge's tolerance). Reconcile the difference against the user's balance
    // at the rate locked on this withdrawal (fxRate = INR per USD).
    const netInr = doc.netInr ?? payload.requestedAmount;
    const paidInr = payload.paidAmount;
    const differenceInr = round2(netInr - paidInr);
    const balanceAdjustmentUsd =
      doc.fxRate > 0 ? round2(differenceInr / doc.fxRate) : 0;

    doc.status = WithdrawalStatus.Paid;
    doc.processedBy = null; // system-confirmed via payment proof
    doc.processedAt = new Date();
    doc.decisionReason = 'Auto-confirmed via payment-proof (P2P match)';
    doc.paymentProofUrl = payload.imageUrl;
    doc.blurredProofUrl = payload.blurredImageUrl ?? null;
    doc.paidInr = paidInr;
    doc.differenceInr = differenceInr;
    // Positive refunds USD to available balance; negative pushes it negative.
    // Applied via sumLockedFor (effective lock = amount - balanceAdjustmentUsd).
    doc.balanceAdjustmentUsd = balanceAdjustmentUsd;
    if (extractedUtr) doc.utr = extractedUtr.trim().toUpperCase();
    // Overpayment tag from the bridge (payer sent more than announced). Recorded
    // as a flag only — it does NOT affect the settled amount or balance math above.
    if (typeof payload.overpaidBy === 'number' && payload.overpaidBy > 0) {
      doc.overpaidBy = payload.overpaidBy;
      doc.screenshotAmountInr =
        typeof payload.screenshotAmount === 'number'
          ? payload.screenshotAmount
          : null;
    }
    await doc.save();
    DailyLogger.log(`Withdrawal callback settled: id=${doc._id}, requestedAmount=${payload.requestedAmount}, paidAmount=${payload.paidAmount}, diff=${payload.differenceInr}`, 'WithdrawalsService');

    void this.userModel.findById(doc.userId).select('name email serialId').then((u) => {
      if (u) {
        void DailyLogger.transactionAlert({
          type: 'Withdrawal',
          status: 'Paid (P2P Settled)',
          username: u.serialId || u.email || doc.userId.toString(),
          name: u.name || 'User',
          amount: `${doc.amount} USDT (₹${paidInr.toLocaleString('en-IN')})`,
          time: new Date(),
          destinationOrWallet: doc.upiId ?? undefined,
          txIdOrRef: doc.utr || (doc._id as Types.ObjectId).toString(),
          extraDetails: {
            'Settled Via': 'P2P Telegram Match',
            'Paid INR': `₹${paidInr.toLocaleString('en-IN')}`,
            ...(doc.utr ? { 'UTR': doc.utr } : {}),
            ...(doc.paymentProofUrl ? { 'Receipt': doc.paymentProofUrl } : {}),
          },
        });
      }
    });

    const disputeWindowExpiresAt = new Date(
      doc.processedAt.getTime() + UPI_DISPUTE_WINDOW_MS,
    ).toISOString();

    // Live push -> frontend opens the dispute modal with the over/under details.
    this.realtime.emitToUser(doc.userId.toString(), 'withdrawal:payment_initiated', {
      withdrawalId: (doc._id as Types.ObjectId).toString(),
      amount: doc.amount,
      requestedInr: netInr,
      paidInr,
      differenceInr,
      balanceAdjustmentUsd,
      method: doc.method,
      upiId: doc.upiId ?? null,
      utr: doc.utr ?? null,
      paymentProofUrl: doc.paymentProofUrl,
      disputeWindowExpiresAt,
    });

    // Keep the existing SMS/email parity with the admin-approval path.
    void this.notifications.notify(
      doc.userId,
      NotificationEvent.WithdrawalApproved,
      {
        amount: doc.amount,
        method: doc.method,
        utr: doc.utr ?? null,
        txHash: null,
      },
    );

    return this.toResponse(doc);
  }

  async handleCpmCallback(payload: Record<string, any>): Promise<WithdrawalResponse | { ok: boolean }> {
    const event = payload.event || (payload.status === 'paid' ? 'payout.success' : undefined);
    const referenceId = payload.referenceId;

    if (!referenceId || !Types.ObjectId.isValid(referenceId)) {
      return { ok: true };
    }

    const doc = await this.withdrawalModel.findById(referenceId);
    if (!doc) {
      return { ok: true };
    }

    if (event === 'payout.success' || payload.status === 'paid') {
      if (doc.status === WithdrawalStatus.Paid) {
        return this.toResponse(doc);
      }
      doc.status = WithdrawalStatus.Paid;
      doc.processedAt = payload.paidAt ? new Date(payload.paidAt) : new Date();
      doc.decisionReason = 'Completed via Central Payout Management (CPM)';
      if (payload.utr) doc.utr = String(payload.utr).trim().toUpperCase();
      if (payload.proofOfPaymentUrl) doc.paymentProofUrl = String(payload.proofOfPaymentUrl);
      if (payload.amount) doc.paidInr = Number(payload.amount);
      await doc.save();

      void this.notifications.notify(
        doc.userId,
        NotificationEvent.WithdrawalApproved,
        { amount: doc.amount, method: doc.method, utr: doc.utr ?? null, txHash: null },
      );
      this.realtime.emitToUser(doc.userId.toString(), 'withdrawal:updated', this.toResponse(doc) as unknown as Record<string, unknown>);
      DailyLogger.log(`Withdrawal ${doc._id} marked Paid from CPM callback (UTR: ${doc.utr})`, 'WithdrawalsService');
      return this.toResponse(doc);
    }

    if (
      event === 'payout.failed' ||
      payload.status === 'failed' ||
      event === 'payout.reversed' ||
      payload.status === 'reversed'
    ) {
      if (doc.status === WithdrawalStatus.Failed) {
        return this.toResponse(doc);
      }
      doc.status = WithdrawalStatus.Failed;
      doc.processedAt = new Date();
      doc.decisionReason = payload.failedReason || payload.reversalReason || 'Failed on Central Payout Management';
      await doc.save();

      void this.notifications.notify(
        doc.userId,
        NotificationEvent.WithdrawalRejected,
        { amount: doc.amount, reason: doc.decisionReason || 'Failed on Central Payout Management' },
      );
      this.realtime.emitToUser(doc.userId.toString(), 'withdrawal:updated', this.toResponse(doc) as unknown as Record<string, unknown>);
      DailyLogger.log(`Withdrawal ${doc._id} marked Failed from CPM callback (${doc.decisionReason})`, 'WithdrawalsService');
      return this.toResponse(doc);
    }

    return this.toResponse(doc);
  }

  // The RECEIVER (user) declines a smart match within their 5-minute window
  // (only while awaiting payment). Cancels the match on the bridge (no re-offer),
  // marks the row failed, and lets Smart re-arm the returned balance.
  async declineSmartMatch(
    userId: string,
    withdrawalId: string,
  ): Promise<WithdrawalResponse> {
    if (!Types.ObjectId.isValid(withdrawalId)) {
      throw new BadRequestException('Invalid withdrawalId');
    }
    const doc = await this.withdrawalModel.findOne({
      _id: new Types.ObjectId(withdrawalId),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException('Transaction not found');
    if (!doc.isSmart || doc.status !== WithdrawalStatus.AwaitingPayment) {
      throw new BadRequestException(
        'This transaction can no longer be declined',
      );
    }
    const matchedAt = doc.smartMatchedAt ? doc.smartMatchedAt.getTime() : 0;
    if (Date.now() > matchedAt + SMART_DECLINE_WINDOW_MS) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'DECLINE_WINDOW_CLOSED',
        message: 'The 5-minute window to decline this payment has closed.',
      });
    }

    // Cancel the match on the bridge (remove announcement, drop payer, no re-offer)
    // and clear the reservation so Smart re-arms the returned balance afresh.
    if (doc.smartRef) {
      await this.payoutBridge.userDeclinePayoutRequest(doc.smartRef);
      await this.smartLiquidation.markReservationCancelled(doc.smartRef);
    }
    doc.status = WithdrawalStatus.Failed;
    doc.processedAt = new Date();
    doc.decisionReason = 'Declined by user (smart 5-min window)';
    await doc.save();

    void this.smartLiquidation.tryArmAllAvailable(userId);
    this.logger.log(
      `[SmartToggle] user ${userId} declined match ${withdrawalId} (ref ${doc.smartRef}).`,
    );
    return this.toResponse(doc);
  }

  // A smart reservation was matched to a payer (bridge announce). Create/refresh
  // the `awaiting_payment` row the user can see and decline within 5 minutes.
  // This row does NOT lock the balance — deduction happens only on the fill.
  async handleSmartUnmatched(dto: { referenceId: string }): Promise<void> {
    const reservation = await this.smartLiquidation.findByReferenceId(
      dto.referenceId,
    );
    if (!reservation) return;

    // Mark the AwaitingPayment row as Failed since it was unmatched by the sender
    const doc = await this.withdrawalModel.findOneAndUpdate(
      {
        smartRef: dto.referenceId,
        status: WithdrawalStatus.AwaitingPayment,
      },
      {
        $set: {
          status: WithdrawalStatus.Failed,
          decisionReason: 'Match expired / Sender failed to pay',
        },
      },
      { new: true }
    );

    await this.smartLiquidation.markReservationUnmatched(dto.referenceId);

    if (doc) {
      this.logger.log(
        `[SmartToggle] UNMATCHED ref ${dto.referenceId} — marked awaiting_payment row as Failed and reverted reservation to Held.`,
      );

      // Notify the frontend to update the row
      this.realtime.emitToUser(doc.userId.toString(), 'withdrawal:unmatched', {
        withdrawalId: (doc._id as Types.ObjectId).toString(),
      });
    }
  }

  async handleSmartMatched(dto: PayoutMatchedCallbackDto): Promise<void> {
    const reservation = await this.smartLiquidation.findByReferenceId(
      dto.referenceId,
    );
    if (
      !reservation ||
      reservation.status === SmartReservationStatus.Cancelled ||
      reservation.status === SmartReservationStatus.Fulfilled
    ) {
      return;
    }

    const userId = reservation.userId as Types.ObjectId;
    const fxRate = reservation.fxRate;
    const amountUsd = fxRate > 0 ? round2(dto.matchedAmount / fxRate) : 0;
    const upiId = reservation.upiId ?? dto.upiId;
    const now = new Date();

    // Already paid for this ref? nothing to do.
    const paid = await this.withdrawalModel.findOne({
      smartRef: dto.referenceId,
      status: WithdrawalStatus.Paid,
    });
    if (paid) return;

    // One awaiting row per ref; reset the 5-min window if it re-matches.
    let row = await this.withdrawalModel.findOne({
      smartRef: dto.referenceId,
      isSmart: true,
      status: WithdrawalStatus.AwaitingPayment,
    });
    const accountHolderName = reservation.accountHolderName;
    if (row) {
      row.amount = amountUsd;
      row.netUsdt = amountUsd;
      row.grossInr = dto.matchedAmount;
      row.netInr = dto.matchedAmount;
      row.upiId = upiId;
      if (accountHolderName) row.accountHolderName = accountHolderName;
      row.smartMatchedAt = now;
      await row.save();
    } else {
      row = await this.withdrawalModel.create({
        userId,
        method: WithdrawalMethod.Upi,
        isSmart: true,
        smartRef: dto.referenceId,
        amount: amountUsd,
        feeRate: 0,
        fxRate,
        feeUsdt: 0,
        netUsdt: amountUsd,
        grossInr: dto.matchedAmount,
        feeInr: 0,
        netInr: dto.matchedAmount,
        upiId,
        accountHolderName: accountHolderName ?? undefined,
        status: WithdrawalStatus.AwaitingPayment,
        smartMatchedAt: now,
        decisionReason: 'Smart auto-liquidation matched — awaiting payer',
      });
    }

    await this.smartLiquidation.markReservationMatched(
      dto.referenceId,
      row._id as Types.ObjectId,
    );

    if (reservation.status === SmartReservationStatus.Held) {
      void this.smartLiquidation.tryArmAllAvailable(userId.toString());
    }

    this.logger.log(
      `[SmartToggle] MATCHED user ${userId.toString()} ref ${dto.referenceId}: ` +
        `₹${dto.matchedAmount} awaiting payment (5-min decline window).`,
    );

    // Push it live so the user sees the declinable row + countdown immediately.
    this.realtime.emitToUser(userId.toString(), 'withdrawal:matched', {
      withdrawalId: (row._id as Types.ObjectId).toString(),
      amount: amountUsd,
      netInr: dto.matchedAmount,
      upiId,
      declineWindowExpiresAt: new Date(
        now.getTime() + SMART_DECLINE_WINDOW_MS,
      ).toISOString(),
    });
  }

  // Settle a smart auto-liquidation fill: mark the matched amount paid (updating
  // the awaiting_payment row if present), clear the reservation, send a receipt,
  // open the dispute modal, and re-arm the remaining balance if Smart is on.
  private async settleSmartFill(
    reservation: SmartReservationDocument,
    payload: PayoutPaidCallbackDto,
  ): Promise<WithdrawalResponse> {
    const userId = reservation.userId as Types.ObjectId;
    const paidInr = payload.paidAmount;
    const fxRate = reservation.fxRate ?? 0;
    const paidUsd = fxRate > 0 ? round2(paidInr / fxRate) : 0;
    const upiId = reservation.upiId ?? payload.upiId;
    const extractedUtr =
      typeof payload.extracted?.utr === 'string' ? payload.extracted.utr : null;

    // If the match already created an `awaiting_payment` row for this ref, settle
    // THAT row → paid (no duplicate); otherwise create it (fallback if the
    // matched-callback was missed). Either way, the balance now locks (paid).
    const fillProcessedAt = new Date();
    const patch = {
      amount: paidUsd,
      feeRate: 0,
      fxRate,
      feeUsdt: 0,
      netUsdt: paidUsd,
      grossInr: paidInr,
      feeInr: 0,
      netInr: paidInr,
      upiId,
      accountHolderName: reservation.accountHolderName ?? undefined,
      status: WithdrawalStatus.Paid,
      processedBy: null,
      processedAt: fillProcessedAt,
      disputeWindowExpiresAt: new Date(fillProcessedAt.getTime() + UPI_DISPUTE_WINDOW_MS),
      decisionReason: 'Smart auto-liquidation payout (P2P match)',
      paymentProofUrl: payload.imageUrl,
      blurredProofUrl: payload.blurredImageUrl ?? null,
      paidInr,
      differenceInr: 0,
      balanceAdjustmentUsd: 0,
      // Overpayment tag (payer sent more than announced, per the screenshot).
      // Flag only — does not affect the settled amount or balance math.
      overpaidBy:
        typeof payload.overpaidBy === 'number' && payload.overpaidBy > 0
          ? payload.overpaidBy
          : null,
      screenshotAmountInr:
        typeof payload.overpaidBy === 'number' &&
        payload.overpaidBy > 0 &&
        typeof payload.screenshotAmount === 'number'
          ? payload.screenshotAmount
          : null,
      utr: extractedUtr ? extractedUtr.trim().toUpperCase() : undefined,
    };
    let created = await this.withdrawalModel.findOne({
      smartRef: payload.referenceId,
      isSmart: true,
      status: WithdrawalStatus.AwaitingPayment,
    });
    if (created) {
      Object.assign(created, patch);
      await created.save();
    } else {
      created = await this.withdrawalModel.create({
        userId,
        method: WithdrawalMethod.Upi,
        isSmart: true,
        smartRef: payload.referenceId,
        ...patch,
      });
    }

    this.logger.log(
      `[SmartToggle] FILL user ${userId.toString()} ref ${payload.referenceId}: ` +
        `Paid ₹${paidInr} (${paidUsd} USDT) to ${upiId ?? '?'}.`,
    );
    DailyLogger.log(`[SmartToggle] FILL user ${userId.toString()} ref ${payload.referenceId}: Paid ₹${paidInr} (${paidUsd} USDT) to ${upiId ?? '?'}.`, 'WithdrawalsService');

    // Open the same "payment received? resolve / raise dispute" modal the manual
    // path shows — a smart fill is also a real payout the user should confirm.
    const disputeWindowExpiresAt = created.processedAt
      ? new Date(
          created.processedAt.getTime() + UPI_DISPUTE_WINDOW_MS,
        ).toISOString()
      : null;
    this.realtime.emitToUser(
      userId.toString(),
      'withdrawal:payment_initiated',
      {
        withdrawalId: (created._id as Types.ObjectId).toString(),
        amount: created.amount,
        requestedInr: paidInr,
        paidInr,
        differenceInr: 0,
        balanceAdjustmentUsd: 0,
        method: created.method,
        upiId: created.upiId ?? null,
        utr: created.utr ?? null,
        paymentProofUrl: created.paymentProofUrl,
        disputeWindowExpiresAt,
      },
    );

    await this.smartLiquidation.markReservationFulfilled(payload.referenceId);
    this.smartLiquidation.notifyFill(userId, paidInr, upiId ?? '');
    void this.smartLiquidation.tryArmAllAvailable(userId.toString());

    return this.toResponse(created);
  }

  async confirmReceived(
    userId: string,
    withdrawalId: string,
  ): Promise<WithdrawalResponse> {
    if (!Types.ObjectId.isValid(withdrawalId)) {
      throw new BadRequestException('Invalid withdrawalId');
    }
    const doc = await this.withdrawalModel.findOne({
      _id: new Types.ObjectId(withdrawalId),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException('Withdrawal not found');
    if (doc.method !== WithdrawalMethod.Upi) {
      throw new BadRequestException(
        'Only UPI withdrawals can be confirmed this way',
      );
    }
    if (doc.status !== WithdrawalStatus.Paid) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'WITHDRAWAL_NOT_PAID',
        message: 'You can only confirm a paid withdrawal.',
      });
    }
    if (doc.userConfirmedAt) {
      return this.toResponse(doc);
    }
    if (!doc.processedAt) {
      throw new BadRequestException('This withdrawal has no payment time on record');
    }
    const windowClosesAt =
      doc.processedAt.getTime() + UPI_DISPUTE_WINDOW_MS;
    if (Date.now() > windowClosesAt) {
      doc.disputeWindowClosedAt = new Date(windowClosesAt);
      await doc.save();
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'DISPUTE_WINDOW_CLOSED',
        message:
          'The confirmation window has closed. Raise a support ticket if you still have an issue.',
      });
    }
    doc.userConfirmedAt = new Date();
    await doc.save();
    DailyLogger.log(`Withdrawal confirmed by user: id=${doc._id}, userId=${doc.userId}`, 'WithdrawalsService');
    return this.toResponse(doc);
  }

  private async findPendingOrFail(
    withdrawalId: string,
  ): Promise<WithdrawalDocument> {
    if (!Types.ObjectId.isValid(withdrawalId)) {
      throw new BadRequestException('Invalid withdrawalId');
    }
    const doc = await this.withdrawalModel.findById(withdrawalId);
    if (!doc) throw new NotFoundException('Withdrawal not found');
    if (
      doc.status !== WithdrawalStatus.Pending &&
      doc.status !== WithdrawalStatus.Processing &&
      doc.status !== WithdrawalStatus.AwaitingPayment
    ) {
      throw new BadRequestException(
        `Withdrawal is already ${doc.status} and cannot be changed`,
      );
    }
    return doc;
  }

  async sumLockedFor(userId: string): Promise<number> {
    const [row] = await this.withdrawalModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          // Only `failed` status releases the lock. In-flight smart matches
          // (awaiting_payment) must lock the balance so they cannot be double-spent.
          status: {
            $nin: [
              WithdrawalStatus.Failed,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $subtract: [
                '$amount',
                { $ifNull: ['$balanceAdjustmentUsd', 0] },
              ],
            },
          },
        },
      },
    ]);
    return row?.total ?? 0;
  }

  async sumPaidFor(userId: string): Promise<number> {
    const [row] = await this.withdrawalModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          status: {
            $in: [
              WithdrawalStatus.Paid,
              WithdrawalStatus.Resolved,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $subtract: [
                '$amount',
                { $ifNull: ['$balanceAdjustmentUsd', 0] },
              ],
            },
          },
        },
      },
    ]);
    return row?.total ?? 0;
  }

  async sumOnHoldFor(userId: string): Promise<number> {
    const [row] = await this.withdrawalModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          status: {
            $in: [
              WithdrawalStatus.Pending,
              WithdrawalStatus.Processing,
              WithdrawalStatus.AwaitingPayment,
              WithdrawalStatus.Reserved,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: '$amount',
          },
        },
      },
    ]);
    return row?.total ?? 0;
  }

  toResponse(d: WithdrawalDocument): WithdrawalResponse {
    const ts = d as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (d._id as Types.ObjectId).toString(),
      userId: d.userId.toString(),
      method: d.method,
      amount: d.amount,
      feeRate: d.feeRate,
      fxRate: d.fxRate,
      feeUsdt: d.feeUsdt,
      netUsdt: d.netUsdt,
      grossInr: d.grossInr ?? null,
      feeInr: d.feeInr ?? null,
      netInr: d.netInr ?? null,
      bankName: d.bankName ?? null,
      accountNumber: d.accountNumber ?? null,
      ifscCode: d.ifscCode ?? null,
      accountHolderName: d.accountHolderName ?? null,
      upiId: d.upiId ?? null,
      network: d.network ?? null,
      destinationAddress: d.destinationAddress ?? null,
      status: d.status,
      txHash: d.txHash ?? null,
      utr: d.utr ?? null,
      notes: d.notes ?? null,
      processedBy: d.processedBy ? d.processedBy.toString() : null,
      processedAt: d.processedAt ? d.processedAt.toISOString() : null,
      decisionReason: d.decisionReason ?? null,
      disputeRaised: d.disputeRaised ?? false,
      paymentProofUrl: d.paymentProofUrl ?? null,
      blurredProofUrl: d.blurredProofUrl ?? null,
      paidInr: d.paidInr ?? null,
      differenceInr: d.differenceInr ?? null,
      balanceAdjustmentUsd: d.balanceAdjustmentUsd ?? 0,
      overpaidBy: d.overpaidBy ?? null,
      screenshotAmountInr: d.screenshotAmountInr ?? null,
      isSmart: d.isSmart ?? false,
      disputeWindowExpiresAt:
        d.method === WithdrawalMethod.Upi &&
        d.status === WithdrawalStatus.Paid &&
        d.processedAt
          ? new Date(
              d.processedAt.getTime() + UPI_DISPUTE_WINDOW_MS,
            ).toISOString()
          : null,
      declineWindowExpiresAt:
        d.isSmart &&
        d.status === WithdrawalStatus.AwaitingPayment &&
        d.smartMatchedAt
          ? new Date(
              d.smartMatchedAt.getTime() + SMART_DECLINE_WINDOW_MS,
            ).toISOString()
          : null,
      userConfirmedAt: d.userConfirmedAt
        ? d.userConfirmedAt.toISOString()
        : null,
      createdAt: ts.createdAt
        ? ts.createdAt.toISOString()
        : new Date().toISOString(),
      updatedAt: ts.updatedAt
        ? ts.updatedAt.toISOString()
        : new Date().toISOString(),
    };
  }
}

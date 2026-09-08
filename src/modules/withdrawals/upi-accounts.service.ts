import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UpiAccount,
  UpiAccountApprovalStatus,
  UpiAccountDocument,
} from './schemas/upi-account.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateUpiAccountDto } from './dto/create-upi-account.dto';
import { SetUpiActiveDto } from './dto/set-upi-active.dto';
import { SetSmartUpiSelectionDto } from './dto/set-smart-upi-selection.dto';
import { AlertsService } from '../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../alerts/schemas/alert.schema';

export interface UpiAccountResponse {
  id: string;
  userId: string;
  upiId: string;
  accountHolderName: string | null;
  isDefault: boolean;
  isActive: boolean;
  approvalStatus: UpiAccountApprovalStatus;
  approvalRequiredFrom: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpiPendingApprovalResponse extends UpiAccountResponse {
  requester: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

export const SHARED_UPI_FREEZE_REASON =
  'Added a UPI ID already owned by another user. Awaiting approval from the original owner.';

@Injectable()
export class UpiAccountsService {
  private readonly logger = new Logger(UpiAccountsService.name);

  constructor(
    @InjectModel(UpiAccount.name)
    private readonly upiAccountModel: Model<UpiAccountDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly alertsService: AlertsService,
  ) {}

  async create(
    userId: string,
    dto: CreateUpiAccountDto,
  ): Promise<UpiAccountResponse> {
    const userObjectId = new Types.ObjectId(userId);
    const upiId = dto.upiId.toLowerCase();

    const existing = await this.upiAccountModel.findOne({
      userId: userObjectId,
      upiId,
    });
    if (existing && !existing.isDeleted) {
      throw new ConflictException(
        'sorry the id is already been registered please contact support',
      );
    }

    // Is this UPI already owned by another active user?
    const firstOwnerUpi = await this.upiAccountModel
      .findOne({
        upiId,
        userId: { $ne: userObjectId },
        isDeleted: { $ne: true },
      });

    if (firstOwnerUpi) {
      throw new ConflictException(
        'sorry the id is already been registered please contact support',
      );
    }

    if (dto.isDefault) {
      await this.upiAccountModel.updateMany(
        { userId: userObjectId, isDefault: true, isDeleted: { $ne: true } },
        { $set: { isDefault: false } },
      );
    }

    if (existing && existing.isDeleted) {
      const activeCount = await this.upiAccountModel.countDocuments({
        userId: userObjectId,
        isDeleted: { $ne: true },
      });
      existing.accountHolderName = dto.accountHolderName;
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.isDefault = dto.isDefault ?? activeCount === 0;
      existing.approvalStatus = UpiAccountApprovalStatus.Approved;
      existing.approvalRequiredFrom = null;
      existing.approvedBy = null;
      existing.approvedAt = null;
      existing.rejectedAt = null;
      await existing.save();
      return this.toResponse(existing);
    }

    const count = await this.upiAccountModel.countDocuments({
      userId: userObjectId,
      isDeleted: { $ne: true },
    });

    const created = await this.upiAccountModel.create({
      userId: userObjectId,
      upiId,
      accountHolderName: dto.accountHolderName,
      isDefault: dto.isDefault ?? count === 0,
    });
    return this.toResponse(created);
  }

  async listForUser(userId: string): Promise<UpiAccountResponse[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const docs = await this.upiAccountModel
      .find({
        userId: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
      })
      .sort({ isDefault: -1, createdAt: -1 });
    return docs.map((d) => this.toResponse(d));
  }

  async getOwnedById(
    userId: string,
    upiAccountId: string,
    opts: {
      includeDeleted?: boolean;
      requireApproved?: boolean;
      requireActive?: boolean;
    } = {},
  ): Promise<UpiAccountDocument> {
    if (!Types.ObjectId.isValid(upiAccountId)) {
      throw new BadRequestException('Invalid upiAccountId');
    }
    const filter: Record<string, unknown> = {
      _id: new Types.ObjectId(upiAccountId),
      userId: new Types.ObjectId(userId),
    };
    if (!opts.includeDeleted) {
      filter.isDeleted = { $ne: true };
    }
    const doc = await this.upiAccountModel.findOne(filter);
    if (!doc) throw new NotFoundException('UPI ID not found');
    if (
      opts.requireApproved &&
      doc.approvalStatus !== UpiAccountApprovalStatus.Approved
    ) {
      throw new BadRequestException(
        'This UPI ID is not yet approved and cannot be used',
      );
    }
    if (opts.requireActive && (doc.isActive ?? true) === false) {
      throw new BadRequestException(
        'This UPI ID is inactive. Activate it before withdrawing.',
      );
    }
    return doc;
  }

  async setDefault(
    userId: string,
    upiAccountId: string,
  ): Promise<UpiAccountResponse> {
    const doc = await this.getOwnedById(userId, upiAccountId, {
      requireApproved: true,
    });
    await this.upiAccountModel.updateMany(
      { userId: new Types.ObjectId(userId), isDefault: true },
      { $set: { isDefault: false } },
    );
    doc.isDefault = true;
    // A default UPI must always be active (deactivating the default is blocked).
    doc.isActive = true;
    await doc.save();
    return this.toResponse(doc);
  }

  async setActive(
    userId: string,
    upiAccountId: string,
    dto: SetUpiActiveDto,
  ): Promise<UpiAccountResponse> {
    const doc = await this.getOwnedById(userId, upiAccountId, {
      requireApproved: true,
    });
    if (dto.isActive === false && doc.isDefault) {
      throw new BadRequestException(
        'Set another UPI as your default before deactivating this one',
      );
    }
    doc.isActive = dto.isActive;
    await doc.save();
    return this.toResponse(doc);
  }

  // ---- Smart UPI selection --------------------------------------------------

  async getSmartSelection(userId: string): Promise<{ enabled: boolean }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const user = await this.userModel
      .findById(userId)
      .select('smartUpiSelectionEnabled');
    if (!user) throw new NotFoundException('User not found');
    return { enabled: user.smartUpiSelectionEnabled ?? false };
  }

  async setSmartSelection(
    userId: string,
    dto: SetSmartUpiSelectionDto,
  ): Promise<{ enabled: boolean }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const res = await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $set: { smartUpiSelectionEnabled: dto.enabled } },
    );
    if (res.matchedCount === 0) throw new NotFoundException('User not found');
    this.logger.log(
      `[SmartToggle] user ${userId} turned Smart UPI ${dto.enabled ? 'ON' : 'OFF'}.`,
    );
    return { enabled: dto.enabled };
  }

  // Resolve the concrete UPI ID a withdrawal should pay out to. Manual choice
  // (saved account or inline handle) always wins; otherwise, if the user has
  // Smart UPI Selection enabled, a random active + approved UPI is chosen.
  async resolveWithdrawalUpiId(
    userId: string,
    opts: { upiAccountId?: string; upiId?: string },
  ): Promise<string> {
    const details = await this.resolveWithdrawalUpiDetails(userId, opts);
    return details.upiId;
  }

  async resolveWithdrawalUpiDetails(
    userId: string,
    opts: { upiAccountId?: string; upiId?: string },
  ): Promise<{ upiId: string; accountHolderName: string | null }> {
    if (opts.upiAccountId) {
      const saved = await this.getOwnedById(userId, opts.upiAccountId, {
        requireApproved: true,
        requireActive: true,
      });
      return { upiId: saved.upiId, accountHolderName: saved.accountHolderName ?? null };
    }
    if (opts.upiId) {
      const found = await this.upiAccountModel.findOne({
        userId: new Types.ObjectId(userId),
        upiId: opts.upiId.toLowerCase().trim(),
        isDeleted: { $ne: true },
      });
      return { upiId: opts.upiId, accountHolderName: found?.accountHolderName ?? null };
    }

    const { enabled } = await this.getSmartSelection(userId);
    if (!enabled) {
      throw new BadRequestException(
        'Select a UPI ID for this withdrawal or enable Smart UPI Selection',
      );
    }
    const chosen = await this.getRandomActiveUpiAccountOrNull(userId);
    if (!chosen) {
      throw new BadRequestException(
        'You have no active approved UPI IDs available for Smart Selection. Add or activate one.',
      );
    }
    return chosen;
  }

  private async pickRandomActiveUpiId(userId: string): Promise<string> {
    const chosen = await this.getRandomActiveUpiIdOrNull(userId);
    if (chosen === null) {
      throw new BadRequestException(
        'You have no active approved UPI IDs available for Smart Selection. Add or activate one.',
      );
    }
    return chosen;
  }

  async getRandomActiveUpiAccountOrNull(
    userId: string,
  ): Promise<{ upiId: string; accountHolderName: string | null } | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const docs = await this.upiAccountModel.find({
      userId: new Types.ObjectId(userId),
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      approvalStatus: {
        $nin: [
          UpiAccountApprovalStatus.Pending,
          UpiAccountApprovalStatus.Rejected,
        ],
      },
    });
    if (docs.length === 0) return null;
    const chosen = docs[Math.floor(Math.random() * docs.length)];
    return { upiId: chosen.upiId, accountHolderName: chosen.accountHolderName ?? null };
  }

  // Non-throwing variant used by Smart auto-liquidation arming: returns null when
  // the user has no active + approved UPI (so arming can silently idle).
  async getRandomActiveUpiIdOrNull(userId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    const docs = await this.upiAccountModel.find({
      userId: new Types.ObjectId(userId),
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      approvalStatus: {
        $nin: [
          UpiAccountApprovalStatus.Pending,
          UpiAccountApprovalStatus.Rejected,
        ],
      },
    });
    if (docs.length === 0) return null;
    const chosen = docs[Math.floor(Math.random() * docs.length)];
    this.logger.log(
      `Smart UPI Selection: user ${userId} → picked "${chosen.upiId}" ` +
        `(from ${docs.length} active approved UPI${docs.length === 1 ? '' : 's'})`,
    );
    return chosen.upiId;
  }

  // True when `upiId` is still a live (not deleted), active, approved UPI for the
  // user. Smart auto-liquidation uses this to detect held reservations whose
  // snapshotted UPI has since been deleted, deactivated, or un-approved.
  async isUpiActiveApprovedForUser(
    userId: string,
    upiId: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const exists = await this.upiAccountModel.exists({
      userId: new Types.ObjectId(userId),
      upiId: upiId.toLowerCase(),
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      approvalStatus: {
        $nin: [
          UpiAccountApprovalStatus.Pending,
          UpiAccountApprovalStatus.Rejected,
        ],
      },
    });
    return Boolean(exists);
  }

  // Returns the deleted UPI ID so callers (e.g. the controller) can tear down any
  // Smart reservation still pointing at it.
  async remove(userId: string, upiAccountId: string): Promise<string> {
    const doc = await this.getOwnedById(userId, upiAccountId);
    const wasDefault = doc.isDefault;
    const removedUpiId = doc.upiId;
    doc.isDeleted = true;
    doc.deletedAt = new Date();
    doc.isDefault = false;
    await doc.save();
    if (wasDefault) {
      const next = await this.upiAccountModel
        .findOne({
          userId: new Types.ObjectId(userId),
          isDeleted: { $ne: true },
        })
        .sort({ createdAt: -1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }
    return removedUpiId;
  }

  // ---- Shared (duplicate) UPI approval flow ---------------------------------

  // A second/third user added a UPI already owned by `firstOwnerUpi`'s user.
  // Save it as pending, freeze the requester until the original owner approves,
  // and alert super admin.
  private async createSharedPendingUpi(
    userObjectId: Types.ObjectId,
    firstOwnerUpi: UpiAccountDocument,
    existing: UpiAccountDocument | null,
    dto: CreateUpiAccountDto,
    upiId: string,
  ): Promise<UpiAccountResponse> {
    const approver = firstOwnerUpi.userId;

    let account: UpiAccountDocument;
    if (existing && existing.isDeleted) {
      existing.accountHolderName = dto.accountHolderName;
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.isDefault = false;
      existing.approvalStatus = UpiAccountApprovalStatus.Pending;
      existing.approvalRequiredFrom = approver;
      existing.approvedBy = null;
      existing.approvedAt = null;
      existing.rejectedAt = null;
      account = await existing.save();
    } else {
      account = await this.upiAccountModel.create({
        userId: userObjectId,
        upiId,
        accountHolderName: dto.accountHolderName,
        isDefault: false,
        approvalStatus: UpiAccountApprovalStatus.Pending,
        approvalRequiredFrom: approver,
      });
    }

    // Freeze the requesting user until the original owner approves.
    await this.userModel.updateOne(
      { _id: userObjectId },
      {
        $set: {
          isFrozen: true,
          frozenAt: new Date(),
          frozenBy: null,
          frozenReason: SHARED_UPI_FREEZE_REASON,
        },
      },
    );

    // Informational alert for super admin (approval itself is owner-driven).
    await this.alertsService.create({
      type: AlertType.UpiAccountShared,
      severity: AlertSeverity.Medium,
      title: 'Shared UPI ID pending owner approval',
      message:
        'A user added a UPI ID already owned by another user. The user has been frozen pending approval from the original owner.',
      primaryUserId: userObjectId,
      secondaryUserId: approver,
      metadata: {
        upiAccountId: (account._id as Types.ObjectId).toString(),
        approvalRequiredFrom: approver.toString(),
        originalUpiAccountId: (firstOwnerUpi._id as Types.ObjectId).toString(),
        submitted: {
          upiId,
          accountHolderName: dto.accountHolderName ?? null,
        },
        detectedAt: new Date().toISOString(),
      },
    });

    return this.toResponse(account);
  }

  async listPendingApprovalsForOwner(
    ownerUserId: string,
  ): Promise<UpiPendingApprovalResponse[]> {
    if (!Types.ObjectId.isValid(ownerUserId)) {
      throw new BadRequestException('Invalid userId');
    }
    const owner = new Types.ObjectId(ownerUserId);
    const docs = await this.upiAccountModel
      .find({
        approvalRequiredFrom: owner,
        approvalStatus: UpiAccountApprovalStatus.Pending,
        isDeleted: { $ne: true },
      })
      .sort({ createdAt: -1 });

    const requesterIds = docs.map((d) => d.userId);
    const requesters = requesterIds.length
      ? await this.userModel
          .find({ _id: { $in: requesterIds } })
          .select('name email')
      : [];
    const requesterMap = new Map<
      string,
      { name: string | null; email: string | null }
    >();
    requesters.forEach((u) =>
      requesterMap.set((u._id as Types.ObjectId).toString(), {
        name: u.name ?? null,
        email: u.email ?? null,
      }),
    );

    return docs.map((d) => {
      const r = requesterMap.get(d.userId.toString());
      return {
        ...this.toResponse(d),
        requester: {
          id: d.userId.toString(),
          name: r?.name ?? null,
          email: r?.email ?? null,
        },
      };
    });
  }

  async approveSharedUpi(
    ownerUserId: string,
    upiAccountId: string,
  ): Promise<UpiAccountResponse> {
    const account = await this.loadPendingForOwner(ownerUserId, upiAccountId);

    account.approvalStatus = UpiAccountApprovalStatus.Approved;
    account.approvedBy = new Types.ObjectId(ownerUserId);
    account.approvedAt = new Date();
    account.rejectedAt = null;

    const otherActive = await this.upiAccountModel.countDocuments({
      userId: account.userId,
      isDeleted: { $ne: true },
      approvalStatus: {
        $nin: [
          UpiAccountApprovalStatus.Pending,
          UpiAccountApprovalStatus.Rejected,
        ],
      },
      _id: { $ne: account._id },
    });
    if (otherActive === 0) {
      account.isDefault = true;
    }
    await account.save();

    // Unfreeze the requester, but only if they were frozen for this reason.
    await this.userModel.updateOne(
      {
        _id: account.userId,
        frozenReason: SHARED_UPI_FREEZE_REASON,
      },
      {
        $set: {
          isFrozen: false,
          frozenAt: null,
          frozenBy: null,
          frozenReason: null,
        },
      },
    );

    return this.toResponse(account);
  }

  async rejectSharedUpi(
    ownerUserId: string,
    upiAccountId: string,
  ): Promise<UpiAccountResponse> {
    const account = await this.loadPendingForOwner(ownerUserId, upiAccountId);

    account.approvalStatus = UpiAccountApprovalStatus.Rejected;
    account.rejectedAt = new Date();
    account.isDefault = false;
    await account.save();
    // The requesting user remains frozen (per product decision).

    return this.toResponse(account);
  }

  private async loadPendingForOwner(
    ownerUserId: string,
    upiAccountId: string,
  ): Promise<UpiAccountDocument> {
    if (!Types.ObjectId.isValid(ownerUserId)) {
      throw new BadRequestException('Invalid userId');
    }
    if (!Types.ObjectId.isValid(upiAccountId)) {
      throw new BadRequestException('Invalid upiAccountId');
    }
    const account = await this.upiAccountModel.findById(upiAccountId);
    if (!account) {
      throw new NotFoundException('Approval request not found');
    }
    if (
      !account.approvalRequiredFrom ||
      account.approvalRequiredFrom.toString() !== ownerUserId
    ) {
      throw new ForbiddenException(
        'You are not authorized to approve this UPI ID',
      );
    }
    if (account.approvalStatus !== UpiAccountApprovalStatus.Pending) {
      throw new BadRequestException('This request has already been processed');
    }
    return account;
  }

  toResponse(d: UpiAccountDocument): UpiAccountResponse {
    const ts = d as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (d._id as Types.ObjectId).toString(),
      userId: d.userId.toString(),
      upiId: d.upiId,
      accountHolderName: d.accountHolderName ?? null,
      isDefault: d.isDefault,
      isActive: d.isActive ?? true,
      approvalStatus: d.approvalStatus ?? UpiAccountApprovalStatus.Approved,
      approvalRequiredFrom: d.approvalRequiredFrom
        ? d.approvalRequiredFrom.toString()
        : null,
      isDeleted: d.isDeleted ?? false,
      deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
      createdAt: ts.createdAt
        ? ts.createdAt.toISOString()
        : new Date().toISOString(),
      updatedAt: ts.updatedAt
        ? ts.updatedAt.toISOString()
        : new Date().toISOString(),
    };
  }
}

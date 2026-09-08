import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BankAccount,
  BankAccountApprovalStatus,
  BankAccountDocument,
} from './schemas/bank-account.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { AlertsService } from '../alerts/alerts.service';
import {
  AlertSeverity,
  AlertType,
} from '../alerts/schemas/alert.schema';

export interface BankAccountResponse {
  id: string;
  userId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string | null;
  isDefault: boolean;
  approvalStatus: BankAccountApprovalStatus;
  approvalRequiredFrom: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PendingApprovalResponse extends BankAccountResponse {
  requester: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

export const SHARED_ACCOUNT_FREEZE_REASON =
  'Added a bank account already owned by another user. Awaiting approval from the original owner.';

@Injectable()
export class BankAccountsService {
  constructor(
    @InjectModel(BankAccount.name)
    private readonly bankAccountModel: Model<BankAccountDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly alertsService: AlertsService,
  ) {}

  async create(
    userId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccountResponse> {
    const userObjectId = new Types.ObjectId(userId);
    const ifsc = dto.ifscCode.toUpperCase();

    const existing = await this.bankAccountModel.findOne({
      userId: userObjectId,
      accountNumber: dto.accountNumber,
      ifscCode: ifsc,
    });
    if (existing && !existing.isDeleted) {
      throw new ConflictException(
        'sorry the id is already been registered please contact support',
      );
    }

    // Is this account already owned by another active user?
    const firstOwnerAccount = await this.bankAccountModel
      .findOne({
        accountNumber: dto.accountNumber,
        userId: { $ne: userObjectId },
        isDeleted: { $ne: true },
      });

    if (firstOwnerAccount) {
      throw new ConflictException(
        'sorry the id is already been registered please contact support',
      );
    }

    if (dto.isDefault) {
      await this.bankAccountModel.updateMany(
        { userId: userObjectId, isDefault: true, isDeleted: { $ne: true } },
        { $set: { isDefault: false } },
      );
    }

    if (existing && existing.isDeleted) {
      const activeCount = await this.bankAccountModel.countDocuments({
        userId: userObjectId,
        isDeleted: { $ne: true },
      });
      existing.accountHolderName = dto.accountHolderName;
      existing.bankName = dto.bankName;
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.isDefault = dto.isDefault ?? activeCount === 0;
      existing.approvalStatus = BankAccountApprovalStatus.Approved;
      existing.approvalRequiredFrom = null;
      existing.approvedBy = null;
      existing.approvedAt = null;
      existing.rejectedAt = null;
      await existing.save();
      return this.toResponse(existing);
    }

    const count = await this.bankAccountModel.countDocuments({
      userId: userObjectId,
      isDeleted: { $ne: true },
    });

    const created = await this.bankAccountModel.create({
      userId: userObjectId,
      accountHolderName: dto.accountHolderName,
      accountNumber: dto.accountNumber,
      ifscCode: ifsc,
      bankName: dto.bankName,
      isDefault: dto.isDefault ?? count === 0,
    });
    return this.toResponse(created);
  }

  async listForUser(userId: string): Promise<BankAccountResponse[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const docs = await this.bankAccountModel
      .find({
        userId: new Types.ObjectId(userId),
        isDeleted: { $ne: true },
      })
      .sort({ isDefault: -1, createdAt: -1 });
    return docs.map((d) => this.toResponse(d));
  }

  async getOwnedById(
    userId: string,
    bankAccountId: string,
    opts: { includeDeleted?: boolean; requireApproved?: boolean } = {},
  ): Promise<BankAccountDocument> {
    if (!Types.ObjectId.isValid(bankAccountId)) {
      throw new BadRequestException('Invalid bankAccountId');
    }
    const filter: Record<string, unknown> = {
      _id: new Types.ObjectId(bankAccountId),
      userId: new Types.ObjectId(userId),
    };
    if (!opts.includeDeleted) {
      filter.isDeleted = { $ne: true };
    }
    const doc = await this.bankAccountModel.findOne(filter);
    if (!doc) throw new NotFoundException('Bank account not found');
    if (
      opts.requireApproved &&
      doc.approvalStatus !== BankAccountApprovalStatus.Approved
    ) {
      throw new BadRequestException(
        'This bank account is not yet approved and cannot be used',
      );
    }
    return doc;
  }

  async setDefault(
    userId: string,
    bankAccountId: string,
  ): Promise<BankAccountResponse> {
    const doc = await this.getOwnedById(userId, bankAccountId, {
      requireApproved: true,
    });
    await this.bankAccountModel.updateMany(
      { userId: new Types.ObjectId(userId), isDefault: true },
      { $set: { isDefault: false } },
    );
    doc.isDefault = true;
    await doc.save();
    return this.toResponse(doc);
  }

  async remove(userId: string, bankAccountId: string): Promise<void> {
    const doc = await this.getOwnedById(userId, bankAccountId);
    const wasDefault = doc.isDefault;
    doc.isDeleted = true;
    doc.deletedAt = new Date();
    doc.isDefault = false;
    await doc.save();
    if (wasDefault) {
      const next = await this.bankAccountModel
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
  }

  // ---- Shared (duplicate) bank account approval flow -------------------------

  // A second/third user added an account already owned by `firstOwnerAccount`'s
  // user. Save it as pending, freeze the requester until the original owner
  // approves, and alert super admin.
  private async createSharedPendingAccount(
    userObjectId: Types.ObjectId,
    firstOwnerAccount: BankAccountDocument,
    existing: BankAccountDocument | null,
    dto: CreateBankAccountDto,
    ifsc: string,
  ): Promise<BankAccountResponse> {
    const approver = firstOwnerAccount.userId;

    let account: BankAccountDocument;
    if (existing && existing.isDeleted) {
      existing.accountHolderName = dto.accountHolderName;
      existing.bankName = dto.bankName;
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.isDefault = false;
      existing.approvalStatus = BankAccountApprovalStatus.Pending;
      existing.approvalRequiredFrom = approver;
      existing.approvedBy = null;
      existing.approvedAt = null;
      existing.rejectedAt = null;
      account = await existing.save();
    } else {
      account = await this.bankAccountModel.create({
        userId: userObjectId,
        accountHolderName: dto.accountHolderName,
        accountNumber: dto.accountNumber,
        ifscCode: ifsc,
        bankName: dto.bankName,
        isDefault: false,
        approvalStatus: BankAccountApprovalStatus.Pending,
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
          frozenReason: SHARED_ACCOUNT_FREEZE_REASON,
        },
      },
    );

    // Informational alert for super admin (approval itself is owner-driven).
    await this.alertsService.create({
      type: AlertType.BankAccountShared,
      severity: AlertSeverity.Medium,
      title: 'Shared bank account pending owner approval',
      message:
        'A user added a bank account already owned by another user. The user has been frozen pending approval from the original owner.',
      primaryUserId: userObjectId,
      secondaryUserId: approver,
      metadata: {
        bankAccountId: (account._id as Types.ObjectId).toString(),
        approvalRequiredFrom: approver.toString(),
        originalBankAccountId: (
          firstOwnerAccount._id as Types.ObjectId
        ).toString(),
        submitted: {
          accountHolderName: dto.accountHolderName,
          accountNumber: dto.accountNumber,
          ifscCode: ifsc,
          bankName: dto.bankName ?? null,
        },
        detectedAt: new Date().toISOString(),
      },
    });

    return this.toResponse(account);
  }

  async listPendingApprovalsForOwner(
    ownerUserId: string,
  ): Promise<PendingApprovalResponse[]> {
    if (!Types.ObjectId.isValid(ownerUserId)) {
      throw new BadRequestException('Invalid userId');
    }
    const owner = new Types.ObjectId(ownerUserId);
    const docs = await this.bankAccountModel
      .find({
        approvalRequiredFrom: owner,
        approvalStatus: BankAccountApprovalStatus.Pending,
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

  async approveSharedAccount(
    ownerUserId: string,
    bankAccountId: string,
  ): Promise<BankAccountResponse> {
    const account = await this.loadPendingForOwner(ownerUserId, bankAccountId);

    account.approvalStatus = BankAccountApprovalStatus.Approved;
    account.approvedBy = new Types.ObjectId(ownerUserId);
    account.approvedAt = new Date();
    account.rejectedAt = null;

    const otherActive = await this.bankAccountModel.countDocuments({
      userId: account.userId,
      isDeleted: { $ne: true },
      approvalStatus: {
        $nin: [
          BankAccountApprovalStatus.Pending,
          BankAccountApprovalStatus.Rejected,
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
        frozenReason: SHARED_ACCOUNT_FREEZE_REASON,
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

  async rejectSharedAccount(
    ownerUserId: string,
    bankAccountId: string,
  ): Promise<BankAccountResponse> {
    const account = await this.loadPendingForOwner(ownerUserId, bankAccountId);

    account.approvalStatus = BankAccountApprovalStatus.Rejected;
    account.rejectedAt = new Date();
    account.isDefault = false;
    await account.save();
    // The requesting user remains frozen (per product decision).

    return this.toResponse(account);
  }

  private async loadPendingForOwner(
    ownerUserId: string,
    bankAccountId: string,
  ): Promise<BankAccountDocument> {
    if (!Types.ObjectId.isValid(ownerUserId)) {
      throw new BadRequestException('Invalid userId');
    }
    if (!Types.ObjectId.isValid(bankAccountId)) {
      throw new BadRequestException('Invalid bankAccountId');
    }
    const account = await this.bankAccountModel.findById(bankAccountId);
    if (!account) {
      throw new NotFoundException('Approval request not found');
    }
    if (
      !account.approvalRequiredFrom ||
      account.approvalRequiredFrom.toString() !== ownerUserId
    ) {
      throw new ForbiddenException(
        'You are not authorized to approve this bank account',
      );
    }
    if (account.approvalStatus !== BankAccountApprovalStatus.Pending) {
      throw new BadRequestException('This request has already been processed');
    }
    return account;
  }

  async update(
    userId: string,
    id: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccountResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid bank account id');
    }
    const userObjectId = new Types.ObjectId(userId);
    const ifsc = dto.ifscCode.toUpperCase();

    const account = await this.bankAccountModel.findOne({
      _id: new Types.ObjectId(id),
      userId: userObjectId,
      isDeleted: { $ne: true },
    });
    if (!account) {
      throw new NotFoundException('Bank account not found');
    }

    // Is this new account number already owned by another active user?
    const firstOwnerAccount = await this.bankAccountModel
      .findOne({
        _id: { $ne: account._id },
        accountNumber: dto.accountNumber,
        userId: { $ne: userObjectId },
        isDeleted: { $ne: true },
      });

    if (firstOwnerAccount) {
      throw new ConflictException(
        'sorry the id is already been registered please contact support',
      );
    }

    // Check if the same user already has ANOTHER active account with the same number
    const duplicate = await this.bankAccountModel.findOne({
      _id: { $ne: account._id },
      userId: userObjectId,
      accountNumber: dto.accountNumber,
      isDeleted: { $ne: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'sorry the id is already been registered please contact support',
      );
    }

    account.accountHolderName = dto.accountHolderName;
    account.accountNumber = dto.accountNumber;
    account.ifscCode = ifsc;
    account.bankName = dto.bankName || undefined;

    if (dto.isDefault) {
      await this.bankAccountModel.updateMany(
        { userId: userObjectId, isDefault: true, isDeleted: { $ne: true } },
        { $set: { isDefault: false } },
      );
      account.isDefault = true;
    }

    await account.save();
    return this.toResponse(account);
  }

  toResponse(d: BankAccountDocument): BankAccountResponse {
    const ts = d as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (d._id as Types.ObjectId).toString(),
      userId: d.userId.toString(),
      accountHolderName: d.accountHolderName,
      accountNumber: d.accountNumber,
      ifscCode: d.ifscCode,
      bankName: d.bankName ?? null,
      isDefault: d.isDefault,
      approvalStatus: d.approvalStatus ?? BankAccountApprovalStatus.Approved,
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

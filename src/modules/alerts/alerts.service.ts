import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Alert,
  AlertDocument,
  AlertResolution,
  AlertSeverity,
  AlertType,
} from './schemas/alert.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  BankAccount,
  BankAccountDocument,
} from '../withdrawals/schemas/bank-account.schema';

export interface CreateAlertInput {
  type: AlertType;
  severity?: AlertSeverity;
  title: string;
  message?: string;
  primaryUserId?: string | Types.ObjectId | null;
  secondaryUserId?: string | Types.ObjectId | null;
  metadata?: Record<string, unknown>;
}

export interface AlertResponse {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  primaryUserId: string | null;
  secondaryUserId: string | null;
  metadata: Record<string, unknown>;
  isResolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string;
  resolution: AlertResolution | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ListAlertsOptions {
  page?: number;
  limit?: number;
  type?: AlertType;
  severity?: AlertSeverity;
  resolved?: boolean;
}

export interface ListAlertsResult {
  items: AlertResponse[];
  total: number;
  unresolvedCount: number;
  page: number;
  limit: number;
}

import * as bcrypt from 'bcrypt';
import { StaffUser, StaffUserDocument } from '../staff/schemas/staff-user.schema';
import { MailerService } from '../two-factor/mailer.service';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectModel(Alert.name)
    private readonly alertModel: Model<AlertDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(BankAccount.name)
    private readonly bankAccountModel: Model<BankAccountDocument>,
    @InjectModel(StaffUser.name)
    private readonly staffUserModel: Model<StaffUserDocument>,
    private readonly mailerService: MailerService,
  ) {}

  async create(input: CreateAlertInput): Promise<AlertResponse> {
    const doc = await this.alertModel.create({
      type: input.type,
      severity: input.severity ?? AlertSeverity.High,
      title: input.title,
      message: input.message ?? '',
      primaryUserId: this.toObjectId(input.primaryUserId),
      secondaryUserId: this.toObjectId(input.secondaryUserId),
      metadata: input.metadata ?? {},
    });
    this.logger.warn(
      `[ALERT] ${doc.type} severity=${doc.severity} title="${doc.title}" primary=${doc.primaryUserId?.toString() ?? 'none'} secondary=${doc.secondaryUserId?.toString() ?? 'none'}`,
    );
    return this.toResponse(doc);
  }

  async list(opts: ListAlertsOptions = {}): Promise<ListAlertsResult> {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

    const filter: FilterQuery<AlertDocument> = {};
    if (opts.type) filter.type = opts.type;
    if (opts.severity) filter.severity = opts.severity;
    if (typeof opts.resolved === 'boolean') filter.isResolved = opts.resolved;

    const [docs, total, unresolvedCount] = await Promise.all([
      this.alertModel
        .find(filter)
        .sort({ isResolved: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.alertModel.countDocuments(filter),
      this.alertModel.countDocuments({ isResolved: false }),
    ]);

    return {
      items: docs.map((d) => this.toResponse(d)),
      total,
      unresolvedCount,
      page,
      limit,
    };
  }

  async getById(id: string): Promise<AlertResponse> {
    const doc = await this.loadAlert(id);
    return this.toResponse(doc);
  }

  async resolve(
    id: string,
    adminId: string,
    resolution: AlertResolution,
    notes?: string,
  ): Promise<AlertResponse> {
    const doc = await this.loadAlert(id);
    if (doc.isResolved) {
      throw new BadRequestException('Alert is already resolved');
    }

    if (resolution === AlertResolution.Cleared) {
      await this.applyClearedSideEffects(doc);
    }

    doc.isResolved = true;
    doc.resolvedAt = new Date();
    doc.resolvedBy = Types.ObjectId.isValid(adminId)
      ? new Types.ObjectId(adminId)
      : null;
    doc.resolutionNotes = (notes ?? '').trim();
    doc.resolution = resolution;
    await doc.save();
    return this.toResponse(doc);
  }

  async grantStaffTempPassword(
    alertId: string,
    adminId: string,
    tempPassword: string,
    notes?: string,
  ): Promise<AlertResponse> {
    const doc = await this.loadAlert(alertId);
    if (doc.isResolved) {
      throw new BadRequestException('Alert is already resolved');
    }

    const staffId = doc.metadata?.staffId as string | undefined;
    if (!staffId || !Types.ObjectId.isValid(staffId)) {
      throw new BadRequestException('Alert metadata does not contain a valid staff ID');
    }

    const staff = await this.staffUserModel.findById(staffId);
    if (!staff) {
      throw new NotFoundException('Staff user not found');
    }

    if (!tempPassword || tempPassword.length < 6) {
      throw new BadRequestException('Temporary password must be at least 6 characters');
    }

    const passwordHash = await bcrypt.hash(tempPassword, 12);
    staff.passwordHash = passwordHash;
    staff.mustChangePassword = true;
    await staff.save();

    doc.isResolved = true;
    doc.resolvedAt = new Date();
    doc.resolvedBy = Types.ObjectId.isValid(adminId)
      ? new Types.ObjectId(adminId)
      : null;
    doc.resolutionNotes = (notes ?? `Temporary password issued by Admin`).trim();
    doc.resolution = AlertResolution.Cleared;
    await doc.save();

    try {
      await this.mailerService.sendTemporaryPasswordEmail(
        staff.email,
        tempPassword,
        staff.fullName,
      );
    } catch (err) {
      this.logger.error(`Failed to send temporary password email to ${staff.email}: ${err}`);
    }

    return this.toResponse(doc);
  }

  private async applyClearedSideEffects(doc: AlertDocument): Promise<void> {
    if (!doc.primaryUserId) return;

    // Shared-account approval is owner-driven, not super-admin-driven. Clearing
    // the informational alert must NOT unfreeze the user or recreate accounts.
    if (doc.type === AlertType.BankAccountShared) return;

    await this.userModel.updateOne(
      { _id: doc.primaryUserId },
      {
        $set: {
          isFrozen: false,
          frozenAt: null,
          frozenBy: null,
          frozenReason: null,
        },
      },
    );

    if (doc.type === AlertType.BankAccountReuse) {
      await this.recreateBankAccountFromAlert(doc);
    }
  }

  private async recreateBankAccountFromAlert(
    doc: AlertDocument,
  ): Promise<void> {
    const submitted = (doc.metadata?.submitted ?? null) as {
      accountHolderName?: string;
      accountNumber?: string;
      ifscCode?: string;
      bankName?: string | null;
      isDefault?: boolean;
    } | null;
    if (
      !submitted ||
      !submitted.accountHolderName ||
      !submitted.accountNumber ||
      !submitted.ifscCode ||
      !doc.primaryUserId
    ) {
      return;
    }

    const userObjectId = doc.primaryUserId as Types.ObjectId;
    const ifsc = submitted.ifscCode.toUpperCase();

    const existing = await this.bankAccountModel.findOne({
      userId: userObjectId,
      accountNumber: submitted.accountNumber,
      ifscCode: ifsc,
    });
    if (existing) {
      if (existing.isDeleted) {
        existing.accountHolderName = submitted.accountHolderName;
        existing.bankName = submitted.bankName ?? undefined;
        existing.isDeleted = false;
        existing.deletedAt = null;
        await existing.save();
      }
      return;
    }

    if (submitted.isDefault) {
      await this.bankAccountModel.updateMany(
        { userId: userObjectId, isDefault: true, isDeleted: { $ne: true } },
        { $set: { isDefault: false } },
      );
    }

    const activeCount = await this.bankAccountModel.countDocuments({
      userId: userObjectId,
      isDeleted: { $ne: true },
    });

    await this.bankAccountModel.create({
      userId: userObjectId,
      accountHolderName: submitted.accountHolderName,
      accountNumber: submitted.accountNumber,
      ifscCode: ifsc,
      bankName: submitted.bankName ?? undefined,
      isDefault: submitted.isDefault ?? activeCount === 0,
    });
  }

  private async loadAlert(id: string): Promise<AlertDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid alert id');
    }
    const doc = await this.alertModel.findById(id);
    if (!doc) throw new NotFoundException('Alert not found');
    return doc;
  }

  private toObjectId(
    v: string | Types.ObjectId | null | undefined,
  ): Types.ObjectId | null {
    if (!v) return null;
    if (v instanceof Types.ObjectId) return v;
    return Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : null;
  }

  private toResponse(doc: AlertDocument): AlertResponse {
    const ts = doc as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (doc._id as Types.ObjectId).toString(),
      type: doc.type,
      severity: doc.severity,
      title: doc.title,
      message: doc.message ?? '',
      primaryUserId: doc.primaryUserId ? doc.primaryUserId.toString() : null,
      secondaryUserId: doc.secondaryUserId
        ? doc.secondaryUserId.toString()
        : null,
      metadata: doc.metadata ?? {},
      isResolved: doc.isResolved,
      resolvedAt: doc.resolvedAt ? doc.resolvedAt.toISOString() : null,
      resolvedBy: doc.resolvedBy ? doc.resolvedBy.toString() : null,
      resolutionNotes: doc.resolutionNotes ?? '',
      resolution: doc.resolution ?? null,
      createdAt: ts.createdAt ? ts.createdAt.toISOString() : null,
      updatedAt: ts.updatedAt ? ts.updatedAt.toISOString() : null,
    };
  }
}

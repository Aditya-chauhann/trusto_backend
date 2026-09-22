import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  User,
  UserDocument,
  UserRole,
} from '../users/schemas/user.schema';
import {
  StaffUser,
  StaffUserDocument,
} from '../staff/schemas/staff-user.schema';
import { SmartLiquidationService } from '../withdrawals/smart-liquidation.service';
import { SweepQueueService } from '../sweep/sweep-queue.service';
import { CryptoApisSubscriptionsService } from '../cryptoapis/cryptoapis-subscriptions.service';
import { AdjustBalanceDto, AdjustmentType } from './dto/adjust-balance.dto';
import { Deposit, DepositDocument } from '../deposits/schemas/deposit.schema';
import { Withdrawal, WithdrawalDocument, WithdrawalMethod, WithdrawalStatus } from '../withdrawals/schemas/withdrawal.schema';
import { MailerService } from '../two-factor/mailer.service';
import { DailyLogger } from '../../common/daily-logger';
import { AdminResetUserPasswordDto } from './dto/reset-user-password.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

export interface ModerationResult {
  id: string;
  serialId?: string | null;
  name: string;
  email: string;
  role: UserRole;
  isBlocked: boolean;
  blockedAt: string | null;
  blockedBy: string | null;
  blockedReason: string | null;
  isFrozen: boolean;
  frozenAt: string | null;
  frozenBy: string | null;
  frozenReason: string | null;
  isOnWatch: boolean;
  watchedAt: string | null;
  watchedBy: string | null;
  watchedReason: string | null;
  smartUpiSelectionEnabled: boolean;
  loginLockedUntil?: string | null;
}

export interface AdminUserListItem extends ModerationResult {
  walletAddress: string | null;
  referralCode: string;
  phone: string | null;
  phoneUpdatedAt?: string | null;
  phoneUpdatedBy?: string | null;
  phoneUpdatedByName?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorVerified: boolean;
  twoFactorMethod: 'email' | 'phone' | null;
  totpEnabled: boolean;
  totpEnabledAt: string | null;
  createdAt: string | null;
  invitedByDetails: {
    id: string;
    name: string;
    referralCode: string;
  } | null;
  isSubscribed: boolean;
  subscriptionStatus: string;
  subscriptionError: string | null;
}

export interface AdminUserListResult {
  items: AdminUserListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ListUsersOptions {
  page?: number;
  limit?: number;
  search?: string;
  role?: UserRole;
  blocked?: boolean;
  frozen?: boolean;
  onWatch?: boolean;
  smartUpi?: boolean;
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(StaffUser.name)
    private readonly staffUserModel: Model<StaffUserDocument>,
    @InjectModel(Deposit.name)
    private readonly depositModel: Model<DepositDocument>,
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    private readonly smartLiquidation: SmartLiquidationService,
    private readonly sweepQueue: SweepQueueService,
    private readonly cryptoApisSubscriptions: CryptoApisSubscriptionsService,
    private readonly mailerService: MailerService,
  ) { }

  async assignAgent(
    targetId: string,
    agentId: string | null,
    adminId: string,
  ): Promise<ModerationResult & {
    assignedAgent: { id: string; fullName: string; email: string } | null;
  }> {
    if (!Types.ObjectId.isValid(targetId)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(targetId);
    if (!user) throw new NotFoundException('User not found');

    if (agentId === null) {
      user.assignedAgent = null;
      user.assignedAgentAt = null;
      user.assignedAgentBy = null;
      user.assignedAgentSource = null;
    } else {
      const agent = await this.staffUserModel.findById(agentId);
      if (!agent || agent.isSuperAdmin || !agent.isActive) {
        throw new BadRequestException('Selected agent is not available');
      }
      user.assignedAgent = agent._id as Types.ObjectId;
      user.assignedAgentAt = new Date();
      user.assignedAgentBy = Types.ObjectId.isValid(adminId)
        ? new Types.ObjectId(adminId)
        : null;
      user.assignedAgentSource = 'admin';
    }
    await user.save();

    let assignedAgent: {
      id: string;
      fullName: string;
      email: string;
    } | null = null;
    if (user.assignedAgent) {
      const agent = await this.staffUserModel
        .findById(user.assignedAgent)
        .select('fullName email');
      if (agent) {
        assignedAgent = {
          id: (agent._id as Types.ObjectId).toString(),
          fullName: agent.fullName,
          email: agent.email,
        };
      }
    }
    return { ...await this.toListItemAsync(user), assignedAgent };
  }

  async setBlocked(
    targetId: string,
    isBlocked: boolean,
    adminId: string,
    reason?: string,
  ): Promise<ModerationResult> {
    const user = await this.loadTarget(targetId, adminId);
    if (user.role === UserRole.SuperAdmin) {
      throw new BadRequestException('Cannot block a super admin');
    }

    user.isBlocked = isBlocked;
    user.blockedAt = isBlocked ? new Date() : null;
    user.blockedBy = isBlocked ? new Types.ObjectId(adminId) : null;
    user.blockedReason = isBlocked ? reason ?? null : null;
    if (!isBlocked) {
      user.loginFailedAttempts = 0;
      user.loginLockedUntil = null;
    }
    await user.save();
    // A blocked user must not keep an armed Smart reservation (which the bridge
    // would otherwise keep announcing in Telegram). On unblock, reconcile re-arms.
    if (isBlocked) {
      await this.smartLiquidation.disarm(targetId);
    }
    return this.toResponse(user);
  }

  async setFrozen(
    targetId: string,
    isFrozen: boolean,
    adminId: string,
    reason?: string,
  ): Promise<ModerationResult> {
    const user = await this.loadTarget(targetId, adminId);
    if (user.role === UserRole.SuperAdmin) {
      throw new BadRequestException('Cannot freeze a super admin');
    }

    user.isFrozen = isFrozen;
    user.frozenAt = isFrozen ? new Date() : null;
    user.frozenBy = isFrozen ? new Types.ObjectId(adminId) : null;
    user.frozenReason = isFrozen ? reason ?? null : null;
    await user.save();
    // A frozen user must not keep an armed Smart reservation. On unfreeze,
    // reconcile re-arms if Smart is still enabled.
    if (isFrozen) {
      await this.smartLiquidation.disarm(targetId);
    }
    return this.toResponse(user);
  }

  async setOnWatch(
    targetId: string,
    isOnWatch: boolean,
    adminId: string,
    reason?: string,
  ): Promise<ModerationResult> {
    const user = await this.loadTarget(targetId, adminId);
    if (user.role === UserRole.SuperAdmin) {
      throw new BadRequestException('Cannot put a super admin on watch');
    }

    user.isOnWatch = isOnWatch;
    user.watchedAt = isOnWatch ? new Date() : null;
    user.watchedBy = isOnWatch ? new Types.ObjectId(adminId) : null;
    user.watchedReason = isOnWatch ? reason ?? null : null;
    await user.save();
    return this.toResponse(user);
  }

  async getById(
    id: string,
  ): Promise<
    AdminUserListItem & {
      assignedAgent: { id: string; fullName: string; email: string } | null;
    }
  > {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    let assignedAgent: {
      id: string;
      fullName: string;
      email: string;
    } | null = null;
    if (user.assignedAgent) {
      const agent = await this.staffUserModel
        .findById(user.assignedAgent)
        .select('fullName email');
      if (agent) {
        assignedAgent = {
          id: (agent._id as Types.ObjectId).toString(),
          fullName: agent.fullName,
          email: agent.email,
        };
      }
    }
    return { ...await this.toListItemAsync(user), assignedAgent };
  }

  async setReferral(
    targetId: string,
    referralCode: string | null | undefined,
    adminId: string,
  ): Promise<AdminUserListItem & {
    assignedAgent: { id: string; fullName: string; email: string } | null;
  }> {
    if (!Types.ObjectId.isValid(targetId)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(targetId);
    if (!user) throw new NotFoundException('User not found');

    if (!referralCode) {
      user.invitedBy = null;
    } else {
      const codeUpper = referralCode.trim().toUpperCase();
      let inviterId: Types.ObjectId | null = null;
      let isStaffInviter = false;

      const userInviter = await this.userModel.findOne({ referralCode: codeUpper });
      if (userInviter) {
        inviterId = userInviter._id as Types.ObjectId;
      } else {
        const staffInviter = await this.staffUserModel.findOne({
          $or: [{ agentCode: codeUpper }, { username: codeUpper.toLowerCase() }],
        });
        if (staffInviter) {
          inviterId = staffInviter._id as Types.ObjectId;
          isStaffInviter = true;
        }
      }

      if (!inviterId) throw new NotFoundException('Referral code not found');
      if (inviterId.toString() === user._id.toString()) {
        throw new BadRequestException('User cannot refer themselves');
      }
      user.invitedBy = inviterId;
      if (isStaffInviter) {
        user.assignedAgent = inviterId;
      }
    }

    await user.save();
    return this.getById(targetId);
  }

  async adjustBalance(
    targetId: string,
    dto: AdjustBalanceDto,
    adminId: string,
  ): Promise<{ message: string; balanceChange: number }> {
    const user = await this.loadTarget(targetId, adminId);

    // Resolve admin name for the alert
    let adminName = 'Super Admin';
    if (Types.ObjectId.isValid(adminId)) {
      const staff = await this.staffUserModel.findById(adminId).select('fullName email isSuperAdmin');
      if (staff) {
        adminName = staff.isSuperAdmin ? 'Super Admin' : (staff.fullName || staff.email);
      } else {
        const adminUser = await this.userModel.findById(adminId).select('name email role');
        if (adminUser) {
          adminName = adminUser.role === UserRole.SuperAdmin ? 'Super Admin' : (adminUser.name || adminUser.email);
        }
      }
    }

    const username = user.serialId || user.email || (user._id ? user._id.toString() : 'Unknown');
    const name = user.name || 'User';

    if (dto.type === AdjustmentType.Credit) {
      const deposit = new this.depositModel({
        transactionId: `ADMIN_${crypto.randomBytes(8).toString('hex')}`,
        userId: user._id,
        walletAddress: user.walletAddress || 'MANUAL_ADJUSTMENT',
        amount: dto.amount,
        currency: 'USDT',
        timestamp: new Date(),
        rawPayload: { remark: dto.remark, adjustedBy: adminId },
      });
      await deposit.save();

      // if (user.walletAddress && user.walletAddress !== 'MANUAL_ADJUSTMENT') {
      //   void this.sweepQueue.enqueue(
      //     user.walletAddress,
      //     deposit._id as Types.ObjectId,
      //   );
      // }

      void DailyLogger.transactionAlert({
        type: 'Deposit',
        status: 'Confirmed (Admin Credit)',
        username,
        name,
        amount: `${dto.amount} USDT`,
        ipAddress: 'Admin Console',
        time: deposit.timestamp || new Date(),
        destinationOrWallet: deposit.walletAddress,
        txIdOrRef: deposit.transactionId,
        extraDetails: {
          'Source': 'Admin Manual Adjustment',
          'Credited By': adminName,
          ...(dto.remark ? { 'Remark': dto.remark } : {}),
        },
      }).catch((err) => {
        DailyLogger.error('Failed to send admin credit transaction alert', err?.stack, 'AdminUsersService');
      });

      return { message: 'Balance credited successfully', balanceChange: dto.amount };
    } else {
      const fxRate = 88.2;
      const netInr = Math.round(dto.amount * fxRate * 100) / 100;

      const withdrawal = new this.withdrawalModel({
        userId: user._id,
        method: WithdrawalMethod.Crypto,
        amount: dto.amount,
        feeRate: 0,
        fxRate: fxRate,
        feeUsdt: 0,
        netUsdt: dto.amount,
        grossInr: netInr,
        feeInr: 0,
        netInr: netInr,
        status: WithdrawalStatus.Paid,
        notes: dto.remark,
        processedBy: new Types.ObjectId(adminId),
        processedAt: new Date(),
        decisionReason: 'Manual debit by Admin',
      });
      await withdrawal.save();

      void DailyLogger.transactionAlert({
        type: 'Withdrawal',
        status: 'Paid (Admin Debit)',
        username,
        name,
        amount: `${dto.amount} USDT`,
        ipAddress: 'Admin Console',
        time: withdrawal.processedAt || new Date(),
        destinationOrWallet: user.walletAddress || 'Admin Manual Debit',
        txIdOrRef: (withdrawal._id as Types.ObjectId).toString(),
        extraDetails: {
          'Source': 'Admin Manual Adjustment',
          'Debited By': adminName,
          ...(dto.remark ? { 'Remark': dto.remark } : {}),
        },
      }).catch((err) => {
        DailyLogger.error('Failed to send admin debit transaction alert', err?.stack, 'AdminUsersService');
      });

      return { message: 'Balance debited successfully', balanceChange: -dto.amount };
    }
  }

  async listAll(opts: ListUsersOptions = {}): Promise<AdminUserListResult> {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

    const filter: FilterQuery<UserDocument> = { role: UserRole.User };
    if (opts.role) filter.role = opts.role;
    if (typeof opts.blocked === 'boolean') filter.isBlocked = opts.blocked;
    if (typeof opts.frozen === 'boolean') filter.isFrozen = opts.frozen;
    if (typeof opts.onWatch === 'boolean') filter.isOnWatch = opts.onWatch;
    if (typeof opts.smartUpi === 'boolean') filter.smartUpiSelectionEnabled = opts.smartUpi;
    if (opts.search && opts.search.trim().length > 0) {
      const escaped = opts.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { name: rx },
        { email: rx },
        { walletAddress: rx },
        { referralCode: rx },
        { phone: rx },
      ];
    }

    const [docs, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.userModel.countDocuments(filter),
    ]);

    return {
      items: await Promise.all(docs.map((d) => this.toListItemAsync(d))),
      total,
      page,
      limit,
    };
  }

  private async toListItemAsync(u: UserDocument): Promise<AdminUserListItem> {
    const createdAt = (u as unknown as { createdAt?: Date }).createdAt;
    let invitedByDetails: { id: string; name: string; referralCode: string; } | null = null;

    if (u.invitedBy) {
      const inviter = await this.userModel.findById(u.invitedBy).select('name referralCode');
      if (inviter) {
        invitedByDetails = {
          id: (inviter._id as Types.ObjectId).toString(),
          name: inviter.name,
          referralCode: inviter.referralCode,
        };
      } else {
        const staffInviter = await this.staffUserModel.findById(u.invitedBy).select('fullName agentCode username');
        if (staffInviter) {
          invitedByDetails = {
            id: (staffInviter._id as Types.ObjectId).toString(),
            name: staffInviter.fullName || staffInviter.username,
            referralCode: staffInviter.agentCode || staffInviter.username.toUpperCase(),
          };
        }
      }
    }

    const walletAddress = u.walletAddress?.trim() || '';
    const sub = walletAddress
      ? await this.cryptoApisSubscriptions.getSubscriptionStatus(walletAddress)
      : { status: 'not_found' as const, lastError: undefined };

    return {
      ...this.toResponse(u),
      walletAddress: u.walletAddress,
      referralCode: u.referralCode,
      phone: u.phone ?? null,
      phoneUpdatedAt: u.phoneUpdatedAt ? u.phoneUpdatedAt.toISOString() : null,
      phoneUpdatedBy: u.phoneUpdatedBy ? u.phoneUpdatedBy.toString() : null,
      phoneUpdatedByName: u.phoneUpdatedByName ?? null,
      emailVerified: u.emailVerified,
      phoneVerified: u.phoneVerified,
      twoFactorVerified: u.twoFactorVerified,
      twoFactorMethod: u.twoFactorMethod ?? null,
      totpEnabled: !!u.totpEnabled,
      totpEnabledAt: u.totpEnabledAt ? u.totpEnabledAt.toISOString() : null,
      createdAt: createdAt ? createdAt.toISOString() : null,
      invitedByDetails,
      isSubscribed: sub.status === 'active',
      subscriptionStatus: sub.status,
      subscriptionError: sub.lastError ?? null,
    };
  }

  private async loadTarget(
    targetId: string,
    adminId: string,
  ): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(targetId)) {
      throw new BadRequestException('Invalid user id');
    }
    if (targetId === adminId) {
      throw new BadRequestException('Cannot moderate yourself');
    }
    const user = await this.userModel.findById(targetId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async subscribeWallet(
    userId: string,
  ): Promise<{ message: string; status: string }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.walletAddress) {
      throw new BadRequestException('User does not have a wallet address');
    }

    const result = await this.cryptoApisSubscriptions.ensureSubscribed(
      user.walletAddress,
    );
    if (result === 'failed') {
      const sub = await this.cryptoApisSubscriptions.getSubscriptionStatus(
        user.walletAddress,
      );
      throw new BadRequestException(
        `Subscription failed: ${sub.lastError || 'Unknown error'}`,
      );
    }
    return {
      message:
        result === 'created'
          ? 'Wallet subscribed successfully'
          : 'Wallet is already subscribed',
      status: 'active',
    };
  }

  async setSmartUpi(
    targetId: string,
    enabled: boolean,
  ): Promise<ModerationResult> {
    if (!Types.ObjectId.isValid(targetId)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(targetId);
    if (!user) throw new NotFoundException('User not found');
    user.smartUpiSelectionEnabled = enabled;
    await user.save();
    if (!enabled) {
      await this.smartLiquidation.disarm(targetId);
    }
    return this.toResponse(user);
  }

  private toResponse(u: UserDocument): ModerationResult {
    return {
      id: (u._id as Types.ObjectId).toString(),
      serialId: u.serialId ?? null,
      name: u.name,
      email: u.email,
      role: u.role,
      isBlocked: u.isBlocked,
      blockedAt: u.blockedAt ? u.blockedAt.toISOString() : null,
      blockedBy: u.blockedBy ? u.blockedBy.toString() : null,
      blockedReason: u.blockedReason ?? null,
      isFrozen: u.isFrozen,
      frozenAt: u.frozenAt ? u.frozenAt.toISOString() : null,
      frozenBy: u.frozenBy ? u.frozenBy.toString() : null,
      frozenReason: u.frozenReason ?? null,
      isOnWatch: u.isOnWatch,
      watchedAt: u.watchedAt ? u.watchedAt.toISOString() : null,
      watchedBy: u.watchedBy ? u.watchedBy.toString() : null,
      watchedReason: u.watchedReason ?? null,
      smartUpiSelectionEnabled: !!u.smartUpiSelectionEnabled,
      loginLockedUntil: u.loginLockedUntil ? u.loginLockedUntil.toISOString() : null,
    };
  }

  async resetUserPassword(
    targetId: string,
    dto: AdminResetUserPasswordDto,
    adminId: string,
  ): Promise<{ ok: boolean; message: string; email: string; temporaryPassword: string }> {
    if (!Types.ObjectId.isValid(targetId)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(targetId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.email) {
      throw new BadRequestException('User does not have a registered email address');
    }

    const tempPassword =
      dto.temporaryPassword?.trim() ||
      `Temp#${crypto.randomInt(100_000, 1_000_000)}`;

    user.passwordHash = await bcrypt.hash(tempPassword, 10);
    user.mustChangePassword = true;
    user.loginFailedAttempts = 0;
    user.loginLockedUntil = null;
    await user.save();

    DailyLogger.log(
      `[ADMIN] SuperAdmin (${adminId}) set temporary password for user=${user.email} (userId=${user._id})`,
      'AdminUsersService',
    );

    await this.mailerService.sendTemporaryPasswordEmail(user.email, tempPassword, user.name || 'User');

    return {
      ok: true,
      message: `Temporary password has been set and sent to ${user.email}`,
      email: user.email,
      temporaryPassword: tempPassword,
    };
  }

  async updatePhone(
    targetId: string,
    phone: string,
    adminId: string,
  ): Promise<
    AdminUserListItem & {
      assignedAgent: { id: string; fullName: string; email: string } | null;
    }
  > {
    if (!Types.ObjectId.isValid(targetId)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(targetId);
    if (!user) throw new NotFoundException('User not found');

    let normalizedPhone = phone.trim();
    if (/^[6-9]\d{9}$/.test(normalizedPhone)) {
      normalizedPhone = `+91${normalizedPhone}`;
    }
    if (!/^\+91[6-9]\d{9}$/.test(normalizedPhone)) {
      throw new BadRequestException(
        'Phone must be a valid 10-digit Indian mobile number in +91XXXXXXXXXX format',
      );
    }

    const existing = await this.userModel.findOne({
      phone: normalizedPhone,
      _id: { $ne: user._id },
    });
    if (existing) {
      throw new ConflictException('Phone number is already registered with another user');
    }

    let adminName = 'Super Admin';
    if (Types.ObjectId.isValid(adminId)) {
      const staff = await this.staffUserModel.findById(adminId).select('fullName username');
      if (staff) {
        adminName = staff.fullName || staff.username;
      }
    }

    user.phone = normalizedPhone;
    user.phoneUpdatedAt = new Date();
    user.phoneUpdatedBy = new Types.ObjectId(adminId);
    user.phoneUpdatedByName = adminName;
    await user.save();

    DailyLogger.log(
      `[ADMIN] SuperAdmin (${adminId}, ${adminName}) updated phone for user=${user.email} (userId=${user._id}) to ${normalizedPhone}`,
      'AdminUsersService',
    );

    return this.getById(targetId);
  }
}

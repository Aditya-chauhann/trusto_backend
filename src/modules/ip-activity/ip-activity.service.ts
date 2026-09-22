import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IpActivity, IpActivityDocument } from './schemas/ip-activity.schema';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { StaffUser, StaffUserDocument } from '../staff/schemas/staff-user.schema';
import { BlockedIp, BlockedIpDocument } from '../ip-block/schemas/blocked-ip.schema';
import { Alert, AlertDocument, AlertSeverity, AlertType } from '../alerts/schemas/alert.schema';
import { IpBlockService } from '../ip-block/ip-block.service';
import { DailyLogger } from '../../common/daily-logger';

@Injectable()
export class IpActivityService implements OnModuleInit {
  constructor(
    @InjectModel(IpActivity.name)
    private readonly ipActivityModel: Model<IpActivityDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(StaffUser.name)
    private readonly staffUserModel: Model<StaffUserDocument>,
    @InjectModel(BlockedIp.name)
    private readonly blockedModel: Model<BlockedIpDocument>,
    @InjectModel(Alert.name)
    private readonly alertModel: Model<AlertDocument>,
  ) {}

  async onModuleInit() {
    await this.purgeSuperAdminActivities();
  }

  async purgeSuperAdminActivities() {
    try {
      const [superAdminUsers, superAdminStaff] = await Promise.all([
        this.userModel.find({ role: UserRole.SuperAdmin }).select('_id email phone'),
        this.staffUserModel.find({ isSuperAdmin: true }).select('_id email username'),
      ]);

      const userIds = superAdminUsers.map((u) => u._id);
      const staffIds = superAdminStaff.map((s) => s._id);
      const emails = [
        ...superAdminUsers.map((u) => u.email).filter(Boolean),
        ...superAdminStaff.map((s) => s.email).filter(Boolean),
      ];

      const res = await this.ipActivityModel.deleteMany({
        $or: [
          { userId: { $in: [...userIds, ...staffIds] } },
          { email: { $in: emails } },
          { 'details.role': 'super_admin' },
          { 'details.role': 'SuperAdmin' },
          { 'details.identifier': { $in: emails } },
        ],
      });
      if (res.deletedCount > 0) {
        DailyLogger.log(
          `[IpActivityService] Purged ${res.deletedCount} historical Super Admin IP activity entries`,
          'IpActivityService',
        );
      }
    } catch (err) {
      DailyLogger.error('Failed to purge super admin IP activities', (err as Error)?.stack, 'IpActivityService');
    }
  }

  async isSuperAdmin(data: {
    userId?: Types.ObjectId;
    email?: string;
    phone?: string;
    identifier?: string;
    details?: Record<string, string>;
  }): Promise<boolean> {
    if (data.details?.role === 'super_admin' || data.details?.role === 'SuperAdmin') {
      return true;
    }

    const email = (data.email || (data.identifier?.includes('@') ? data.identifier : '')).trim().toLowerCase();
    const phone = (data.phone || (data.identifier?.startsWith('+') ? data.identifier : '')).trim();
    const identifier = (data.identifier || '').trim();
    const userId = data.userId;

    if (userId) {
      const u = await this.userModel.findById(userId).select('role');
      if (u && u.role === UserRole.SuperAdmin) return true;
      const s = await this.staffUserModel.findById(userId).select('isSuperAdmin');
      if (s && s.isSuperAdmin) return true;
    }

    if (email) {
      const u = await this.userModel.findOne({ email }).select('role');
      if (u && u.role === UserRole.SuperAdmin) return true;
      const s = await this.staffUserModel.findOne({ email }).select('isSuperAdmin');
      if (s && s.isSuperAdmin) return true;
    }

    if (phone) {
      const u = await this.userModel.findOne({ phone }).select('role');
      if (u && u.role === UserRole.SuperAdmin) return true;
    }

    if (identifier) {
      const s = await this.staffUserModel.findOne({ username: identifier }).select('isSuperAdmin');
      if (s && s.isSuperAdmin) return true;
    }

    return false;
  }

  async log(data: {
    userId?: Types.ObjectId;
    email?: string;
    phone?: string;
    actionType: string;
    ipAddress: string;
    details?: Record<string, string>;
  }): Promise<IpActivityDocument | null> {
    // Exclude any Super Admin activity completely
    if (await this.isSuperAdmin(data)) {
      return null;
    }

    let resolvedIp = data.ipAddress;
    if (
      (!resolvedIp ||
        resolvedIp === '127.0.0.1' ||
        resolvedIp === '::1' ||
        resolvedIp === 'localhost') &&
      IpBlockService.cachedPublicIp
    ) {
      resolvedIp = IpBlockService.cachedPublicIp;
    }

    return this.ipActivityModel.create({
      userId: data.userId || undefined,
      email: data.email || undefined,
      phone: data.phone || undefined,
      actionType: data.actionType,
      ipAddress: resolvedIp,
      details: data.details || undefined,
    });
  }

  async recordFailedAttempt(data: {
    user?: UserDocument | null;
    userId?: Types.ObjectId;
    identifier?: string;
    actionType: 'wrong_password' | 'wrong_captcha';
    ipAddress: string;
    details?: Record<string, string>;
  }): Promise<{ locked: boolean; lockedUntil?: Date }> {
    // Never record or freeze IP for Super Admin
    if (data.user && data.user.role === UserRole.SuperAdmin) {
      return { locked: false };
    }
    if (await this.isSuperAdmin({ userId: data.userId, identifier: data.identifier, details: data.details })) {
      return { locked: false };
    }

    const { actionType, details } = data;
    let ipAddress = data.ipAddress;
    if (
      (!ipAddress ||
        ipAddress === '127.0.0.1' ||
        ipAddress === '::1' ||
        ipAddress === 'localhost') &&
      IpBlockService.cachedPublicIp
    ) {
      ipAddress = IpBlockService.cachedPublicIp;
    }

    // Resolve user if not provided directly
    let user = data.user || null;
    if (!user && data.userId) {
      user = await this.userModel.findById(data.userId);
    }
    if (!user && data.identifier) {
      const clean = data.identifier.trim();
      const isPhone = clean.startsWith('+');
      const normalized = isPhone ? clean : clean.toLowerCase();
      user = isPhone
        ? await this.userModel.findOne({ phone: normalized })
        : await this.userModel.findOne({ email: normalized });
    }

    if (user && user.role === UserRole.SuperAdmin) {
      return { locked: false };
    }

    // 1. Log the individual wrong attempt into IpActivity
    await this.log({
      userId: user?._id as Types.ObjectId | undefined,
      email: user?.email || (data.identifier?.includes('@') ? data.identifier : undefined),
      phone: user?.phone || (data.identifier?.startsWith('+') ? data.identifier : undefined),
      actionType,
      ipAddress,
      details: {
        ...(details || {}),
        identifier: data.identifier || '',
      },
    });

    // 2. Track failed attempts for registered user
    if (user) {
      user.loginFailedAttempts = (user.loginFailedAttempts || 0) + 1;

      const attemptLabel = actionType === 'wrong_captcha' ? 'wrong captcha' : 'wrong password';
      DailyLogger.security(
        `[AUTH_ALERT] Failed login attempt (${attemptLabel}) for: ${user.email || user.phone} (attempt ${user.loginFailedAttempts}/5) from IP: ${ipAddress}`,
        'IpActivityService',
      );

      if (user.loginFailedAttempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        user.loginLockedUntil = lockUntil;
        user.isBlocked = true;
        user.blockedAt = new Date();
        user.blockedReason = '5 failed login attempts (wrong password/captcha)';
        const attempts = user.loginFailedAttempts;
        user.loginFailedAttempts = 0;
        await user.save();

        // Automatically freeze the IP for 1 hour
        const freezeUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour freeze
        await this.blockedModel.updateOne(
          { ip: ipAddress },
          {
            blockedUntil: freezeUntil,
            reason: 'Automatically frozen for 1 hour: 5 failed login attempts (wrong password/captcha)',
          },
          { upsert: true },
        );

        // Send Telegram security alert
        DailyLogger.security(
          `[CRITICAL] Account LOCKED (5 failed attempts): ${user.name || user.email || user.phone} from IP: ${ipAddress}`,
          'IpActivityService',
        );

        // Create Active Alert for Admin
        await this.alertModel.create({
          type: AlertType.FailedLoginAttempts,
          severity: AlertSeverity.High,
          title: 'Repeated Failed Login Attempts (5 times)',
          message: `User ${user.name || user.email || user.phone} failed 5 consecutive login attempts (${actionType === 'wrong_captcha' ? 'wrong captcha' : 'wrong password'}) from IP: ${ipAddress}.`,
          primaryUserId: user._id,
          metadata: {
            ip: ipAddress,
            identifier: user.email || user.phone || data.identifier,
            email: user.email,
            phone: user.phone,
            userName: user.name,
            attempts,
            actionType,
          },
        });

        // Log lock event in audit
        await this.log({
          userId: user._id as Types.ObjectId,
          email: user.email,
          phone: user.phone,
          actionType: 'account_locked',
          ipAddress,
          details: { durationMinutes: '15', reason: '5 consecutive failed attempts' },
        });

        return { locked: true, lockedUntil: lockUntil };
      }

      await user.save();
      return { locked: false };
    }

    // 3. Track failed attempts per IP for anonymous / unregistered probes
    const windowStart = new Date(Date.now() - 15 * 60 * 1000); // 15 mins window
    const ipFails = await this.ipActivityModel.countDocuments({
      ipAddress,
      actionType: { $in: ['wrong_password', 'wrong_captcha'] },
      createdAt: { $gte: windowStart },
    });

    if (ipFails >= 5 && ipFails % 5 === 0) {
      // Automatically freeze the suspicious IP for 1 hour
      const freezeUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour freeze
      await this.blockedModel.updateOne(
        { ip: ipAddress },
        {
          blockedUntil: freezeUntil,
          reason: 'Automatically frozen for 1 hour: 5 failed login attempts from IP',
        },
        { upsert: true },
      );

      DailyLogger.security(
        `[CRITICAL] IP AUTO-FROZEN for 1 hour: ${ipAddress} (5 failed attempts from this IP)`,
        'IpActivityService',
      );

      await this.alertModel.create({
        type: AlertType.FailedLoginAttempts,
        severity: AlertSeverity.High,
        title: 'Repeated Failed Login Attempts from IP (5 times)',
        message: `Suspicious IP ${ipAddress} failed 5 consecutive login attempts (${actionType === 'wrong_captcha' ? 'wrong captcha' : 'wrong credentials'}).`,
        metadata: {
          ip: ipAddress,
          identifier: data.identifier || 'Anonymous',
          attempts: ipFails,
          actionType,
        },
      });
    }

    return { locked: false };
  }

  async listAll(
    filters: { actionType?: string; q?: string; page?: number; limit?: number } = {},
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? filters.limit : 50;
    const skip = (page - 1) * limit;

    const query: any = {};

    if (filters.actionType && filters.actionType !== 'all') {
      query.actionType = filters.actionType;
    }

    if (filters.q) {
      const q = filters.q.trim();
      const orConditions: any[] = [
        { ipAddress: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
      ];

      // If it looks like a User ObjectId, check it directly
      if (Types.ObjectId.isValid(q)) {
        orConditions.push({ userId: new Types.ObjectId(q) });
      }

      // Check if user has serialId matching q (e.g. TR12)
      const matchingUsers = await this.userModel.find({
        $or: [
          { serialId: { $regex: q, $options: 'i' } },
          { name: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
        ]
      }).select('_id');

      if (matchingUsers.length > 0) {
        const uids = matchingUsers.map(u => u._id);
        orConditions.push({ userId: { $in: uids } });
      }

      query.$or = orConditions;
    }

    // Exclude all Super Admin activities from query
    const [superAdminUsers, superAdminStaff] = await Promise.all([
      this.userModel.find({ role: UserRole.SuperAdmin }).select('_id email phone'),
      this.staffUserModel.find({ isSuperAdmin: true }).select('_id email username'),
    ]);

    const superAdminUserIds = superAdminUsers.map((u) => u._id);
    const superAdminStaffIds = superAdminStaff.map((s) => s._id);
    const allSuperAdminIds = [...superAdminUserIds, ...superAdminStaffIds];
    const allSuperAdminEmails = [
      ...superAdminUsers.map((u) => u.email).filter(Boolean),
      ...superAdminStaff.map((s) => s.email).filter(Boolean),
    ].map((e) => e.toLowerCase());

    const superAdminExclusions: any[] = [
      { userId: { $nin: allSuperAdminIds } },
      { email: { $nin: allSuperAdminEmails } },
      { 'details.role': { $ne: 'super_admin' } },
      { 'details.role': { $ne: 'SuperAdmin' } },
      { 'details.identifier': { $nin: allSuperAdminEmails } },
    ];

    if (query.$and) {
      query.$and.push(...superAdminExclusions);
    } else {
      query.$and = superAdminExclusions;
    }

    const [docs, total, totalBlockedIps, totalBlockedUsers, totalFrozenIps] = await Promise.all([
      this.ipActivityModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'userId',
          select: '_id name email phone serialId isBlocked blockedReason isFrozen frozenReason',
          model: 'User',
        })
        .exec(),
      this.ipActivityModel.countDocuments(query),
      this.blockedModel.countDocuments({
        blockedUntil: { $gt: new Date() },
      }),
      this.userModel.countDocuments({
        isBlocked: true,
      }),
      this.blockedModel.countDocuments({
        blockedUntil: {
          $gt: new Date(),
          $lte: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      }),
    ]);

    const returnedIps = Array.from(new Set(docs.map(d => d.ipAddress).filter(Boolean)));
    const missingEmails = docs.filter((d: any) => !d.userId && d.email).map((d: any) => d.email.toLowerCase());
    const missingPhones = docs.filter((d: any) => !d.userId && d.phone).map((d: any) => d.phone);

    const [activeBlocks, fallbackUsers] = await Promise.all([
      this.blockedModel.find({
        ip: { $in: returnedIps },
        blockedUntil: { $gt: new Date() },
      }),
      (missingEmails.length > 0 || missingPhones.length > 0)
        ? this.userModel.find({
            $or: [
              { email: { $in: missingEmails } },
              { phone: { $in: missingPhones } },
            ],
          }).select('_id serialId name email phone isBlocked blockedReason isFrozen frozenReason')
        : Promise.resolve([]),
    ]);

    const blockedIpMap = new Map<string, any>();
    activeBlocks.forEach(b => blockedIpMap.set(b.ip, b));

    const fallbackUserMap = new Map<string, any>();
    fallbackUsers.forEach((fu: any) => {
      if (fu.email) fallbackUserMap.set(fu.email.toLowerCase(), fu);
      if (fu.phone) fallbackUserMap.set(fu.phone, fu);
    });

    const items = docs.map((doc: any) => {
      let u = doc.userId;
      if (!u && doc.email && fallbackUserMap.has(doc.email.toLowerCase())) {
        u = fallbackUserMap.get(doc.email.toLowerCase());
      }
      if (!u && doc.phone && fallbackUserMap.has(doc.phone)) {
        u = fallbackUserMap.get(doc.phone);
      }
      const block = blockedIpMap.get(doc.ipAddress);
      return {
        id: (doc._id as Types.ObjectId).toString(),
        userId: u ? u._id.toString() : null,
        userSerialId: u ? u.serialId : null,
        userName: u ? u.name : null,
        userEmail: u ? u.email : doc.email || null,
        userPhone: u ? u.phone : doc.phone || null,
        userIsBlocked: u ? Boolean(u.isBlocked) : false,
        userBlockedReason: u ? u.blockedReason || null : null,
        userIsFrozen: u ? Boolean(u.isFrozen) : false,
        userFrozenReason: u ? u.frozenReason || null : null,
        actionType: doc.actionType,
        ipAddress: doc.ipAddress,
        isBlocked: !!block,
        blockedUntil: block ? block.blockedUntil.toISOString() : null,
        blockedReason: block ? block.reason : null,
        details: doc.details ? Object.fromEntries(doc.details) : null,
        createdAt: doc.createdAt.toISOString(),
      };
    });

    return {
      items,
      total,
      page,
      limit,
      stats: {
        totalBlockedIps,
        totalBlockedUsers,
        totalFrozenIps,
        totalLogs: total,
      },
    };
  }

  async blockIp(ip: string, reason?: string, durationHours?: number): Promise<{ ok: true }> {
    const hours = durationHours && durationHours > 0 ? durationHours : 24;
    const blockedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    const blockReason = reason || `Manually blocked by admin for ${hours} hours`;

    await this.blockedModel.updateOne(
      { ip },
      { blockedUntil, reason: blockReason },
      { upsert: true },
    );

    return { ok: true };
  }

  async unblockIp(ip: string): Promise<{ ok: true }> {
    await this.blockedModel.deleteOne({ ip });
    return { ok: true };
  }
}

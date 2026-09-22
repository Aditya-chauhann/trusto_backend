import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { StaffUser, StaffUserDocument } from '../staff/schemas/staff-user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { validatePasswordSecurity } from '../../common/utils/password-validator.util';

const BCRYPT_ROUNDS = 12;

interface CreateUserInput {
  _id?: Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  walletAddress?: string | null;
  assignedAgent?: Types.ObjectId | null;
  invitedBy?: Types.ObjectId | null;
}

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_CODE_MAX_ATTEMPTS = 10;

export function isDuplicateKeyError(err: unknown, field: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  return e.code === 11000 && Boolean(e.keyPattern && field in e.keyPattern);
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(StaffUser.name) private readonly staffUserModel: Model<StaffUserDocument>,
  ) {}

  async onModuleInit() {
    const usersWithoutSerial = await this.userModel
      .find({
        $or: [
          { serialId: { $exists: false } },
          { serialId: null },
          { serialId: '' },
        ],
      })
      .sort({ createdAt: 1 });

    if (usersWithoutSerial.length === 0) {
      return;
    }

    const allAssigned = await this.userModel
      .find({ serialId: { $regex: /^TR\d+$/ } })
      .select('serialId');

    let maxNum = 0;
    for (const u of allAssigned) {
      const match = u.serialId.match(/^TR(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) {
          maxNum = num;
        }
      }
    }

    for (const user of usersWithoutSerial) {
      maxNum += 1;
      await this.userModel.updateOne(
        { _id: user._id },
        { $set: { serialId: `TR${maxNum}` } },
      );
    }
  }

  findByEmail(email: string) {
    return this.userModel.findOne({ email: email.toLowerCase() });
  }

  findByPhone(phone: string) {
    return this.userModel.findOne({ phone });
  }

  async findByReferralCode(referralCode: string) {
    if (!referralCode) return null;
    const codeUpper = referralCode.trim().toUpperCase();
    const userReferrer = await this.userModel.findOne({ referralCode: codeUpper });
    if (userReferrer) return userReferrer;

    const staffReferrer = await this.staffUserModel.findOne({
      $or: [{ agentCode: codeUpper }, { username: codeUpper.toLowerCase() }],
    });
    if (staffReferrer) {
      return {
        _id: staffReferrer._id,
        isStaff: true,
        referralCode: staffReferrer.agentCode || staffReferrer.username.toUpperCase(),
      };
    }
    return null;
  }

  findById(id: string) {
    return this.userModel.findById(id);
  }

  async create(data: CreateUserInput) {
    const referralCode = await this.generateUniqueReferralCode();
    const serialId = await this.getNextSerialId();
    const userId = data._id || new Types.ObjectId();
    return this.userModel.create({
      _id: userId,
      serialId,
      name: data.name,
      email: data.email.toLowerCase(),
      phone: data.phone,
      passwordHash: data.passwordHash,
      walletAddress: data.walletAddress ?? `UNVERIFIED_${userId}`,
      referralCode,
      ...(data.assignedAgent
        ? {
            assignedAgent: data.assignedAgent,
            assignedAgentAt: new Date(),
            assignedAgentSource: 'signup' as const,
          }
        : {}),
      ...(data.invitedBy ? { invitedBy: data.invitedBy } : {}),
    });
  }

  private async getNextSerialId(): Promise<string> {
    const lastUser = await this.userModel
      .findOne({ serialId: { $regex: /^TR\d+$/ } })
      .sort({ createdAt: -1 });

    if (!lastUser || !lastUser.serialId) {
      return 'TR1';
    }

    const match = lastUser.serialId.match(/^TR(\d+)$/);
    const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
    return `TR${nextNum}`;
  }

  deleteById(id: string | Types.ObjectId) {
    return this.userModel.deleteOne({ _id: id });
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    if (
      dto.name === undefined &&
      dto.email === undefined &&
      dto.phone === undefined &&
      dto.newPassword === undefined
    ) {
      throw new BadRequestException('No fields to update');
    }

    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    if (dto.name !== undefined) {
      user.name = dto.name.trim();
    }

    if (dto.email !== undefined) {
      const normalized = dto.email.toLowerCase().trim();
      if (normalized !== user.email) {
        const existing = await this.userModel
          .findOne({ email: normalized })
          .select('_id');
        if (existing && !(existing._id as Types.ObjectId).equals(user._id as Types.ObjectId)) {
          throw new ConflictException('Email already in use');
        }
        user.email = normalized;
        user.emailVerified = false;
        if (user.twoFactorMethod === 'email') {
          user.twoFactorVerified = false;
          user.twoFactorMethod = null;
        }
      }
    }

    if (dto.phone !== undefined) {
      const normalized = dto.phone.trim();
      if (normalized !== user.phone) {
        const existing = await this.userModel
          .findOne({ phone: normalized })
          .select('_id');
        if (existing && !(existing._id as Types.ObjectId).equals(user._id as Types.ObjectId)) {
          throw new ConflictException('Phone number already in use');
        }
        user.phone = normalized;
        user.phoneVerified = false;
      }
    }

    if (dto.newPassword !== undefined) {
      if (!dto.currentPassword) {
        throw new BadRequestException(
          'currentPassword is required to change password',
        );
      }
      const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!ok) throw new UnauthorizedException('Current password is incorrect');

      const secValidation = validatePasswordSecurity(dto.newPassword, {
        name: user.name,
        email: user.email,
        serialId: user.serialId,
      });
      if (!secValidation.isValid) {
        throw new BadRequestException(secValidation.message);
      }

      user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    }

    try {
      await user.save();
    } catch (err: unknown) {
      if (isDuplicateKeyError(err, 'phone')) {
        throw new ConflictException('Phone number already in use');
      }
      if (isDuplicateKeyError(err, 'email')) {
        throw new ConflictException('Email already in use');
      }
      throw err;
    }

    return {
      id: (user._id as Types.ObjectId).toString(),
      serialId: user.serialId ?? null,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      walletAddress: user.walletAddress,
      referralCode: user.referralCode,
      role: user.role,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      twoFactorVerified: user.twoFactorVerified,
      twoFactorMethod: user.twoFactorMethod,
      totpEnabled: !!user.totpEnabled,
      totpEnabledAt: user.totpEnabledAt ?? null,
    };
  }

  async getDashboard(id: string) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const createdAt = (user as unknown as { createdAt?: Date }).createdAt;
    const walletAddress =
      user.walletAddress && !user.walletAddress.startsWith('UNVERIFIED_')
        ? user.walletAddress
        : null;

    return {
      profile: {
        id: (user._id as Types.ObjectId).toString(),
        serialId: user.serialId ?? null,
        name: user.name,
        email: user.email,
        phone: user.phone ?? null,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        referralCode: user.referralCode,
        role: user.role,
        createdAt,
      },
      walletAddress,
      twoFactorVerified: user.twoFactorVerified,
      twoFactorMethod: user.twoFactorMethod,
      totpEnabled: !!user.totpEnabled,
      totpEnabledAt: user.totpEnabledAt ?? null,
      isBlocked: user.isBlocked,
      isFrozen: user.isFrozen,
      smartUpiSelectionEnabled: user.smartUpiSelectionEnabled ?? false,
      balances: {
        totalDeposits: '0.00',
        totalWithdrawals: '0.00',
        onHold: '0.00',
        available: '0.00',
        referralEarnings: '0.00',
        currency: 'USDT',
      },
    };
  }

  private async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt += 1) {
      const code = this.randomReferralCode();
      const exists = await this.userModel.exists({ referralCode: code });
      if (!exists) return code;
    }
    throw new InternalServerErrorException(
      'Could not generate a unique referral code',
    );
  }

  private randomReferralCode(): string {
    const bytes = randomBytes(REFERRAL_CODE_LENGTH);
    let out = '';
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
      out += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
    }
    return out;
  }
}

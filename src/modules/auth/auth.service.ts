import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
// CHANGED: added randomInt alongside the existing randomUUID import — randomInt
// generates the 6-digit password reset code, same pattern TwoFactorService uses.
import { randomInt, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
// CHANGED: added the User class import (was previously type-only `UserDocument`)
// because forgotPassword/resetPassword need @InjectModel(User.name) directly.
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { StaffAuthService } from '../staff/staff-auth.service';
import { StaffUser, StaffUserDocument } from '../staff/schemas/staff-user.schema';
import { IpActivityService } from '../ip-activity/ip-activity.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LoginTotpDto } from '../two-factor/dto/login-totp.dto';
import { TotpService } from '../two-factor/totp.service';
import { CryptoApisSubscriptionsService } from '../cryptoapis/cryptoapis-subscriptions.service';
import type { TotpPrincipalType } from '../two-factor/totp.service';
// ADDED: mailer + new DTOs for the forgot/reset password flow.
import { MailerService } from '../two-factor/mailer.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { DailyLogger } from '../../common/daily-logger';
import { validatePasswordSecurity } from '../../common/utils/password-validator.util';

const BCRYPT_ROUNDS = 12;

// ADDED: constants for the password reset OTP (10 min TTL, 5 attempt cap —
// same shape as TwoFactorService's OTP_TTL_MS / MAX_VERIFY_ATTEMPTS).
const PASSWORD_RESET_OTP_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly staffAuthService: StaffAuthService,
    private readonly totpService: TotpService,
    @InjectModel(StaffUser.name)
    private readonly staffUserModel: Model<StaffUserDocument>,
    private readonly cryptoApisSubscriptions: CryptoApisSubscriptionsService,
    // ADDED: mailer for sending the reset code, and direct User model access
    // for the OTP fields (findByEmail on UsersService doesn't select them).
    private readonly mailerService: MailerService,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly ipActivityService: IpActivityService,
  ) {}

  async register(dto: RegisterDto, ip?: string) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException(
        'password and confirmPassword do not match',
      );
    }

    const COMMON_PASSWORDS = ['12345678', 'password', 'qwerty', '123456', 'password123', 'admin123', 'trusto123', 'tronpay123'];
    if (COMMON_PASSWORDS.includes(dto.password.toLowerCase())) {
      throw new BadRequestException(
        'The password is too common and easily guessable. Please choose a more secure password.',
      );
    }

    const secValidation = validatePasswordSecurity(dto.password, {
      name: dto.name,
      email: dto.email,
    });
    if (!secValidation.isValid) {
      throw new BadRequestException(secValidation.message);
    }

    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const existingStaff = await this.staffUserModel.findOne({ email: dto.email.toLowerCase().trim() });
    if (existingStaff) {
      throw new ConflictException('Agent already exist please sign in through admin/staff portal');
    }

    const phoneTaken = await this.usersService.findByPhone(dto.phone);
    if (phoneTaken) {
      throw new ConflictException('Phone number already registered');
    }

    let assignedAgent: Types.ObjectId | null = null;
    if (dto.assignedAgentId) {
      const agent = await this.staffUserModel.findById(dto.assignedAgentId);
      if (!agent || agent.isSuperAdmin || !agent.isActive) {
        throw new BadRequestException('Selected agent is not available');
      }
      assignedAgent = agent._id as Types.ObjectId;
    }

    let invitedBy: Types.ObjectId | null = null;
    if (dto.referralCode) {
      const referrer = await this.usersService.findByReferralCode(dto.referralCode);
      if (referrer) {
        invitedBy = referrer._id as Types.ObjectId;
        if ((referrer as any).isStaff) {
          assignedAgent = referrer._id as Types.ObjectId;
        }
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const userId = new Types.ObjectId();

    const user = await this.usersService.create({
      _id: userId,
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      passwordHash,
      walletAddress: `UNVERIFIED_${userId}`,
      assignedAgent,
      invitedBy,
    });

    if (ip) {
      void this.ipActivityService.log({
        userId: user._id as Types.ObjectId,
        email: user.email,
        phone: user.phone,
        actionType: 'login_success',
        ipAddress: ip,
        details: { note: 'Account registered (awaiting verification)' },
      }).catch(() => {});
    }
    return await this.buildSessionResponse(user);
  }

  async login(dto: LoginDto, ip?: string) {
    const identifier = dto.identifier.trim();
    const isPhone = identifier.startsWith('+');
    const normalized = isPhone ? identifier : identifier.toLowerCase();

    const user = isPhone
      ? await this.usersService.findByPhone(normalized)
      : await this.usersService.findByEmail(normalized);

    if (user) {
      const isSuperAdmin = user.role === UserRole.SuperAdmin;

      if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
        if (ip && !isSuperAdmin) {
          void this.ipActivityService.log({
            userId: user._id as Types.ObjectId,
            email: user.email,
            phone: user.phone,
            actionType: 'login_failed',
            ipAddress: ip,
            details: { reason: 'Account locked' },
          }).catch(() => {});
        }
        throw new ForbiddenException({
          statusCode: 403,
          errorCode: 'ACCOUNT_TEMPORARILY_LOCKED',
          message: `Too many failed login attempts. Please try again after ${user.loginLockedUntil.toLocaleTimeString()}`,
          lockedUntil: user.loginLockedUntil.toISOString(),
        });
      }

      const ok = await bcrypt.compare(dto.password, user.passwordHash);
      if (!ok) {
        if (!isSuperAdmin) {
          const result = await this.ipActivityService.recordFailedAttempt({
            user,
            identifier: normalized,
            actionType: 'wrong_password',
            ipAddress: ip || '127.0.0.1',
          });

          if (result.locked && result.lockedUntil) {
            throw new ForbiddenException({
              statusCode: 403,
              errorCode: 'ACCOUNT_TEMPORARILY_LOCKED',
              message: 'Too many failed login attempts. Your account has been locked for 15 minutes.',
              lockedUntil: result.lockedUntil.toISOString(),
            });
          }
        }
        throw new UnauthorizedException('Invalid credentials');
      }

      if (user.loginFailedAttempts > 0 || user.loginLockedUntil) {
        user.loginFailedAttempts = 0;
        user.loginLockedUntil = null;
        await user.save();
      }

      if (user.isBlocked) {
        if (ip && !isSuperAdmin) {
          void this.ipActivityService.log({
            userId: user._id as Types.ObjectId,
            email: user.email,
            phone: user.phone,
            actionType: 'login_failed',
            ipAddress: ip,
            details: { reason: 'User blocked' },
          }).catch(() => {});
        }
        throw new ForbiddenException({
          statusCode: 403,
          errorCode: 'ACCOUNT_BLOCKED',
          message: 'Your account has been blocked. Please contact support.',
          reason: user.blockedReason ?? null,
        });
      }

      if (ip && !isSuperAdmin) {
        void this.ipActivityService.log({
          userId: user._id as Types.ObjectId,
          email: user.email,
          phone: user.phone,
          actionType: 'login_success',
          ipAddress: ip,
        }).catch(() => {});
      }

      if (user.totpEnabled) {
        const id = (user._id as Types.ObjectId).toString();
        return {
          accountType: 'user' as const,
          requiresTotp: true,
          loginChallenge: this.createLoginChallenge(id, 'user'),
          user: {
            id,
            email: user.email,
            name: user.name,
          },
        };
      }

      DailyLogger.log(`[AUTH] User login successful: id=${user._id}, email=${user.email}`, 'AuthService');
      return {
        accountType: 'user' as const,
        ...(await this.buildSessionResponse(user)),
      };
    }

    if (ip) {
      void this.ipActivityService.log({
        email: !isPhone ? normalized : undefined,
        phone: isPhone ? normalized : undefined,
        actionType: 'login_failed',
        ipAddress: ip,
        details: { reason: 'User not found' },
      }).catch(() => {});
    }

    if (isPhone) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const staff = await this.staffUserModel.findOne({ email: normalized });
    if (staff) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'STAFF_USE_ADMIN_LOGIN',
        message: 'Staff accounts must sign in through the admin login page.',
      });
    }

    throw new UnauthorizedException('Invalid credentials');
  }

  async completeLoginWithTotp(dto: LoginTotpDto) {
    let payload: {
      sub?: string;
      type?: string;
      principalType?: TotpPrincipalType;
    };
    try {
      payload = this.jwtService.verify(dto.loginChallenge);
    } catch {
      throw new UnauthorizedException('Login challenge expired or invalid');
    }

    if (
      payload.type !== 'login_challenge' ||
      !payload.sub ||
      !payload.principalType
    ) {
      throw new UnauthorizedException('Invalid login challenge');
    }

    await this.totpService.verifyLogin(
      payload.sub,
      payload.principalType,
      dto.code,
    );

    if (payload.principalType === 'staff') {
      const staff = await this.staffUserModel.findById(payload.sub);
      if (!staff || !staff.isActive) {
        throw new UnauthorizedException('Invalid credentials');
      }
      staff.lastLoginAt = new Date();
      await staff.save();
      return await this.staffAuthService.buildSession(staff);
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.isBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'ACCOUNT_BLOCKED',
        message: 'Your account has been blocked. Please contact support.',
        reason: user.blockedReason ?? null,
      });
    }

    return {
      accountType: 'user' as const,
      ...(await this.buildSessionResponse(user)),
    };
  }

  // ADDED: forgot-password — always returns the same generic message whether
  // or not the email exists, so the endpoint can't be used to enumerate users.
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userModel.findOne({ email });

    const genericResponse = {
      message: 'If an account exists for that email, a reset code has been sent.',
    };

    if (!user) return genericResponse;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    user.passwordResetOtpHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    user.passwordResetOtpExpiresAt = new Date(
      Date.now() + PASSWORD_RESET_OTP_TTL_MS,
    );
    user.passwordResetOtpAttempts = 0;
    await user.save();

    DailyLogger.log(`[AUTH] Password reset code generated: email=${user.email}, expiry=${user.passwordResetOtpExpiresAt.toISOString()}`, 'AuthService');
    await this.mailerService.sendPasswordResetEmail(user.email, code);

    return genericResponse;
  }

  // ADDED: reset-password — verifies the OTP against the hashed value,
  // enforces expiry + attempt cap, then updates passwordHash and clears the OTP.
  async resetPassword(dto: ResetPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userModel
      .findOne({ email })
      .select('+passwordResetOtpHash');

    if (
      !user ||
      !user.passwordResetOtpHash ||
      !user.passwordResetOtpExpiresAt
    ) {
      throw new BadRequestException('Invalid or expired code');
    }
    if (user.passwordResetOtpExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Invalid or expired code');
    }
    if (user.passwordResetOtpAttempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many failed attempts. Please request a new code.',
      );
    }

    const ok = await bcrypt.compare(dto.otp, user.passwordResetOtpHash);
    if (!ok) {
      user.passwordResetOtpAttempts += 1;
      await user.save();
      DailyLogger.security(`[AUTH_ALERT] Failed password reset attempt (incorrect OTP): email=${user.email}, attemptCount=${user.passwordResetOtpAttempts}`, 'AuthService');
      throw new BadRequestException('Invalid or expired code');
    }

    const COMMON_PASSWORDS = ['12345678', 'password', 'qwerty', '123456', 'password123', 'admin123', 'trusto123', 'tronpay123'];
    if (COMMON_PASSWORDS.includes(dto.newPassword.toLowerCase())) {
      throw new BadRequestException(
        'The password is too common and easily guessable. Please choose a more secure password.',
      );
    }

    const secValidation = validatePasswordSecurity(dto.newPassword, {
      name: user.name,
      email: user.email,
      serialId: user.serialId,
    });
    if (!secValidation.isValid) {
      throw new BadRequestException(secValidation.message);
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpAttempts = 0;
    await user.save();

    DailyLogger.log(`[AUTH] Password reset successful: email=${user.email}`, 'AuthService');
    return { message: 'Password updated successfully' };
  }

  async changeUserPassword(userId: string, currentPassword?: string, newPassword?: string) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('currentPassword and newPassword are required');
    }
    const user = await this.userModel.findById(userId);
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Current temporary password is incorrect');
    }

    const secValidation = validatePasswordSecurity(newPassword, {
      name: user.name,
      email: user.email,
    });
    if (!secValidation.isValid) {
      throw new BadRequestException(secValidation.message);
    }

    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.mustChangePassword = false;
    await user.save();

    DailyLogger.log(`[AUTH] User password changed successfully: id=${user._id}, email=${user.email}`, 'AuthService');
    return { ok: true, message: 'Password updated successfully' };
  }

  private createLoginChallenge(
    principalId: string,
    principalType: TotpPrincipalType,
  ): string {
    const expiresIn =
      this.configService.get<string>('jwt.loginChallengeExpiresIn') ?? '5m';
    return this.jwtService.sign(
      {
        sub: principalId,
        type: 'login_challenge',
        principalType,
        jti: randomUUID(),
      },
      { expiresIn },
    );
  }

  private async buildSessionResponse(user: UserDocument) {
    const id = (user._id as Types.ObjectId).toString();
    const accessToken = this.jwtService.sign({
      sub: id,
      type: 'user',
      email: user.email,
    });

    let assignedAgent: {
      id: string;
      fullName: string;
      email: string;
    } | null = null;
    if (user.assignedAgent) {
      const agent = await this.staffUserModel
        .findById(user.assignedAgent)
        .select('fullName email isActive');
      if (agent && agent.isActive) {
        assignedAgent = {
          id: (agent._id as Types.ObjectId).toString(),
          fullName: agent.fullName,
          email: agent.email,
        };
      }
    }

    return {
      accessToken,
      user: {
        id,
        name: user.name,
        email: user.email,
        walletAddress:
          user.walletAddress && !user.walletAddress.startsWith('UNVERIFIED_')
            ? user.walletAddress
            : null,
        referralCode: user.referralCode,
        role: user.role,
        assignedAgent,
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    };
  }
}
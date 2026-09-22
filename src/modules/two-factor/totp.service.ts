import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  StaffUser,
  StaffUserDocument,
} from '../staff/schemas/staff-user.schema';
import {
  decryptSecret,
  encryptSecret,
} from '../../common/utils/secret-crypto.util';
import { DailyLogger } from '../../common/daily-logger';

export type TotpPrincipalType = 'user' | 'staff';

const TOTP_ISSUER = 'TrustO';
const MAX_VERIFY_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

authenticator.options = { window: 1 };

export interface TotpSetupResult {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export interface TotpStatusResult {
  totpEnabled: boolean;
  totpEnabledAt: string | null;
}

interface RateLimitEntry {
  attempts: number;
  lockedUntil: number | null;
}

@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly verifyAttempts = new Map<string, RateLimitEntry>();

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(StaffUser.name)
    private readonly staffUserModel: Model<StaffUserDocument>,
    private readonly config: ConfigService,
  ) {}

  async setup(
    principalId: string,
    principalType: TotpPrincipalType,
  ): Promise<TotpSetupResult> {
    const principal = await this.findPrincipal(principalId, principalType);
    if (principal.totpEnabled) {
      throw new ConflictException(
        'Google Authenticator is already enabled. Disable it first to set up again.',
      );
    }

    const secret = authenticator.generateSecret();
    const accountLabel =
      principalType === 'staff'
        ? (principal as StaffUserDocument).email
        : (principal as UserDocument).email;
    const otpauthUrl = authenticator.keyuri(
      accountLabel,
      TOTP_ISSUER,
      secret,
    );
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    return { secret, otpauthUrl, qrDataUrl };
  }

  async enable(
    principalId: string,
    principalType: TotpPrincipalType,
    secret: string,
    code: string,
  ): Promise<TotpStatusResult> {
    const principal = await this.findPrincipal(principalId, principalType);
    if (principal.totpEnabled) {
      throw new ConflictException('Google Authenticator is already enabled');
    }

    if (!this.verifyCode(secret, code)) {
      throw new BadRequestException('Incorrect code. Check your authenticator app and try again.');
    }

    const encryptionKey = this.getEncryptionKey();
    principal.totpSecret = encryptSecret(secret, encryptionKey);
    principal.totpEnabled = true;
    principal.totpEnabledAt = new Date();
    await principal.save();

    DailyLogger.security(`[SECURITY] 2FA (TOTP) was ENABLED for principalId=${principalId}, type=${principalType}`, 'TotpService');
    this.clearRateLimit(principalId, principalType);

    return this.status(principalId, principalType);
  }

  async disable(
    principalId: string,
    principalType: TotpPrincipalType,
    password: string,
    code: string,
  ): Promise<TotpStatusResult> {
    const principal = await this.findPrincipalWithSecret(
      principalId,
      principalType,
    );
    if (!principal.totpEnabled || !principal.totpSecret) {
      throw new BadRequestException('Google Authenticator is not enabled');
    }

    const passwordHash =
      principalType === 'staff'
        ? (principal as StaffUserDocument).passwordHash
        : (principal as UserDocument).passwordHash;
    const passwordOk = await bcrypt.compare(password, passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Incorrect password');
    }

    const secret = decryptSecret(principal.totpSecret, this.getEncryptionKey());
    if (!this.verifyCode(secret, code)) {
      throw new BadRequestException('Incorrect authenticator code');
    }

    principal.totpEnabled = false;
    principal.totpSecret = null;
    principal.totpEnabledAt = null;
    await principal.save();

    DailyLogger.security(`[SECURITY CRITICAL] 2FA (TOTP) was DISABLED for principalId=${principalId}, type=${principalType}`, 'TotpService');
    this.clearRateLimit(principalId, principalType);

    return this.status(principalId, principalType);
  }

  async status(
    principalId: string,
    principalType: TotpPrincipalType,
  ): Promise<TotpStatusResult> {
    const principal = await this.findPrincipal(principalId, principalType);
    return {
      totpEnabled: !!principal.totpEnabled,
      totpEnabledAt: principal.totpEnabledAt
        ? principal.totpEnabledAt.toISOString()
        : null,
    };
  }

  async verifyLogin(
    principalId: string,
    principalType: TotpPrincipalType,
    code: string,
  ): Promise<void> {
    this.assertNotRateLimited(principalId, principalType);

    const principal = await this.findPrincipalWithSecret(
      principalId,
      principalType,
    );
    if (!principal.totpEnabled || !principal.totpSecret) {
      throw new BadRequestException('Google Authenticator is not enabled');
    }

    const secret = decryptSecret(principal.totpSecret, this.getEncryptionKey());
    if (!this.verifyCode(secret, code)) {
      this.recordFailedAttempt(principalId, principalType);
      throw new BadRequestException('Incorrect authenticator code');
    }

    this.clearRateLimit(principalId, principalType);
  }

  private verifyCode(secret: string, code: string): boolean {
    return authenticator.check(code, secret);
  }

  private getEncryptionKey(): string {
    const key = this.config.get<string>('walletEncryptionKey');
    if (!key) {
      throw new Error('walletEncryptionKey is not configured');
    }
    return key;
  }

  private rateLimitKey(
    principalId: string,
    principalType: TotpPrincipalType,
  ): string {
    return `${principalType}:${principalId}`;
  }

  private assertNotRateLimited(
    principalId: string,
    principalType: TotpPrincipalType,
  ): void {
    const key = this.rateLimitKey(principalId, principalType);
    const entry = this.verifyAttempts.get(key);
    if (!entry?.lockedUntil) return;
    if (entry.lockedUntil <= Date.now()) {
      this.verifyAttempts.delete(key);
      return;
    }
    throw new HttpException(
      'Too many failed authenticator attempts. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private recordFailedAttempt(
    principalId: string,
    principalType: TotpPrincipalType,
  ): void {
    const key = this.rateLimitKey(principalId, principalType);
    const entry = this.verifyAttempts.get(key) ?? {
      attempts: 0,
      lockedUntil: null,
    };
    entry.attempts += 1;
    if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
      entry.lockedUntil = Date.now() + LOCKOUT_MS;
      this.logger.warn(
        `TOTP login locked: ${principalType}=${principalId} attempts=${entry.attempts}`,
      );
    }
    this.verifyAttempts.set(key, entry);
  }

  private clearRateLimit(
    principalId: string,
    principalType: TotpPrincipalType,
  ): void {
    this.verifyAttempts.delete(
      this.rateLimitKey(principalId, principalType),
    );
  }

  private async findPrincipal(
    principalId: string,
    principalType: TotpPrincipalType,
  ): Promise<UserDocument | StaffUserDocument> {
    const principal =
      principalType === 'staff'
        ? await this.staffUserModel.findById(principalId)
        : await this.userModel.findById(principalId);
    if (!principal) throw new NotFoundException('Account not found');
    return principal;
  }

  private async findPrincipalWithSecret(
    principalId: string,
    principalType: TotpPrincipalType,
  ): Promise<UserDocument | StaffUserDocument> {
    const principal =
      principalType === 'staff'
        ? await this.staffUserModel
            .findById(principalId)
            .select('+totpSecret +passwordHash')
        : await this.userModel
            .findById(principalId)
            .select('+totpSecret +passwordHash');
    if (!principal) throw new NotFoundException('Account not found');
    return principal;
  }
}

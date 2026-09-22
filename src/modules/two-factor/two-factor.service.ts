import {
  BadRequestException,
  ConflictException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { User, UserDocument } from '../users/schemas/user.schema';
import { isDuplicateKeyError } from '../users/users.service';
import {
  OtpChallenge,
  OtpChallengeDocument,
  OtpChannel,
} from './schemas/otp-challenge.schema';
import { MailerService } from './mailer.service';
import { SmsService } from './sms.service';

import { WalletsService } from '../wallets/wallets.service';
import { CryptoApisSubscriptionsService } from '../cryptoapis/cryptoapis-subscriptions.service';

const OTP_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_SENDS = 3;
const MAX_VERIFY_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 10;

export interface SendCodeResult {
  otpId: string;
  channel: OtpChannel;
  contact: string;
  expiresAt: string;
}

export interface VerifyResult {
  twoFactorVerified: boolean;
  twoFactorMethod: 'email' | 'phone' | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  email: string;
  phone: string | null;
  walletAddress?: string | null;
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  /** Redacts a contact for logs: keeps just enough to identify it. */
  private mask(contact: string): string {
    if (contact.includes('@')) {
      const [name, domain] = contact.split('@');
      const head = name.slice(0, 2);
      return `${head}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
    }
    return contact.length > 4
      ? `${contact.slice(0, 3)}****${contact.slice(-2)}`
      : '****';
  }

  constructor(
    @InjectModel(OtpChallenge.name)
    private readonly otpModel: Model<OtpChallengeDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly mailer: MailerService,
    private readonly sms: SmsService,
    private readonly walletsService: WalletsService,
    @Inject(forwardRef(() => CryptoApisSubscriptionsService))
    private readonly cryptoApisSubscriptions: CryptoApisSubscriptionsService,
  ) {}

  async sendCode(
    userId: string,
    channel?: OtpChannel,
    rawPhone?: string,
    rawEmail?: string,
  ): Promise<SendCodeResult> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const resolvedChannel = this.resolveChannel(user, channel, rawPhone);

    let contact: string;
    if (resolvedChannel === OtpChannel.Phone) {
      const phone = this.normalizePhone(rawPhone ?? user.phone);
      const ownedByOther = await this.userModel
        .findOne({ phone, _id: { $ne: user._id } })
        .select('_id');
      if (ownedByOther) {
        throw new ConflictException('Phone number already in use');
      }
      if (!user.phone || user.phone !== phone) {
        user.phone = phone;
        user.phoneVerified = false;
        try {
          await user.save();
        } catch (err: unknown) {
          if (isDuplicateKeyError(err, 'phone')) {
            throw new ConflictException('Phone number already in use');
          }
          throw err;
        }
      }
      contact = phone;
    } else {
      const email = this.normalizeEmail(rawEmail ?? user.email);
      const ownedByOther = await this.userModel
        .findOne({ email, _id: { $ne: user._id } })
        .select('_id');
      if (ownedByOther) {
        throw new ConflictException('Email already in use');
      }
      if (!user.email || user.email !== email) {
        user.email = email;
        user.emailVerified = false;
        try {
          await user.save();
        } catch (err: unknown) {
          if (isDuplicateKeyError(err, 'email')) {
            throw new ConflictException('Email already in use');
          }
          throw err;
        }
      }
      contact = email;
    }

    if (process.env.OTP_RATE_LIMIT_DISABLED !== 'true') {
      const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
      const recent = await this.otpModel.countDocuments({
        userId: user._id,
        channel: resolvedChannel,
        createdAt: { $gt: since },
      });
      if (recent >= RATE_LIMIT_MAX_SENDS) {
        this.logger.warn(
          `OTP rate-limited: user=${userId} channel=${resolvedChannel} contact=${this.mask(contact)} sends=${recent}/${RATE_LIMIT_MAX_SENDS} in last ${RATE_LIMIT_WINDOW_MS / 60000}min`,
        );
        throw new HttpException(
          'Too many OTP requests. Please wait before requesting another.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    this.logger.log(
      `OTP send requested: user=${userId} channel=${resolvedChannel} contact=${this.mask(contact)}`,
    );

    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Laaffic (like the email channel) is a plain delivery gateway with no
    // managed verify API, so we generate + hash + store the code ourselves
    // for both channels and only differ in how the code is delivered.
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);

    if (resolvedChannel === OtpChannel.Email) {
      await this.mailer.sendOtpEmail(contact, code);
    } else {
      await this.sms.sendOtpSms(contact, code);
    }

    const challenge = await this.otpModel.create({
      userId: user._id,
      channel: resolvedChannel,
      contact,
      codeHash,
      expiresAt,
    });

    this.logger.log(
      `OTP dispatched: otpId=${(challenge._id as Types.ObjectId).toString()} channel=${resolvedChannel} contact=${this.mask(contact)} expiresAt=${expiresAt.toISOString()}`,
    );

    return {
      otpId: (challenge._id as Types.ObjectId).toString(),
      channel: resolvedChannel,
      contact,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verifyCode(
    userId: string,
    otpId: string,
    code: string,
  ): Promise<VerifyResult> {
    if (!Types.ObjectId.isValid(otpId)) {
      throw new BadRequestException('Invalid otpId');
    }

    const challenge = await this.otpModel.findOne({
      _id: new Types.ObjectId(otpId),
      userId: new Types.ObjectId(userId),
    });
    if (!challenge) {
      throw new BadRequestException('OTP challenge not found or expired');
    }
    if (challenge.consumed) {
      throw new BadRequestException('OTP already used');
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('OTP expired');
    }
    if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw new BadRequestException(
        'Too many failed attempts on this code. Request a new one.',
      );
    }

    // Both channels store a bcrypt-hashed code locally now (Laaffic has no
    // provider-side verify), so verification is identical for email and phone.
    if (!challenge.codeHash) {
      throw new BadRequestException('OTP challenge is malformed');
    }
    const ok = await bcrypt.compare(code, challenge.codeHash);

    if (!ok) {
      challenge.attempts += 1;
      await challenge.save();
      this.logger.warn(
        `OTP verify failed: otpId=${otpId} channel=${challenge.channel} contact=${this.mask(challenge.contact)} attempts=${challenge.attempts}/${MAX_VERIFY_ATTEMPTS}`,
      );
      throw new BadRequestException('Incorrect code');
    }

    challenge.consumed = true;
    await challenge.save();

    this.logger.log(
      `OTP verified: otpId=${otpId} channel=${challenge.channel} contact=${this.mask(challenge.contact)} user=${userId}`,
    );

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (challenge.channel === OtpChannel.Phone) {
      user.phone = challenge.contact;
      user.phoneVerified = true;
    } else {
      user.emailVerified = true;
    }
    user.twoFactorVerified = true;
    user.twoFactorMethod = challenge.channel;

    if (!user.walletAddress || user.walletAddress.startsWith('UNVERIFIED_')) {
      try {
        const wallet = await this.walletsService.claimUnused(
          user._id as Types.ObjectId,
        );
        user.walletAddress = wallet.address;
        void this.cryptoApisSubscriptions
          .ensureSubscribed(wallet.address)
          .catch(() => {});
        this.logger.log(
          `Assigned wallet ${wallet.address} to verified user ${user.serialId || user._id}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to claim wallet for verified user ${user._id}: ${(err as Error).message}`,
        );
      }
    }

    await user.save();

    return {
      twoFactorVerified: user.twoFactorVerified,
      twoFactorMethod: user.twoFactorMethod,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      email: user.email,
      phone: user.phone ?? null,
      walletAddress: user.walletAddress ?? null,
    };
  }

  async setPreference(
    userId: string,
    method: OtpChannel,
  ): Promise<VerifyResult> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (method === OtpChannel.Phone && !user.phoneVerified) {
      throw new BadRequestException(
        'Verify your phone number before setting it as the primary 2FA method',
      );
    }
    if (method === OtpChannel.Email && !user.emailVerified) {
      throw new BadRequestException(
        'Verify your email before setting it as the primary 2FA method',
      );
    }

    user.twoFactorMethod = method;
    await user.save();

    return {
      twoFactorVerified: user.twoFactorVerified,
      twoFactorMethod: user.twoFactorMethod,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      email: user.email,
      phone: user.phone ?? null,
    };
  }

  private resolveChannel(
    user: UserDocument,
    requested: OtpChannel | undefined,
    rawPhone: string | undefined,
  ): OtpChannel {
    if (requested) return requested;
    if (rawPhone) return OtpChannel.Phone;
    if (user.twoFactorMethod) return user.twoFactorMethod as OtpChannel;
    if (user.phoneVerified || user.phone) return OtpChannel.Phone;
    return OtpChannel.Email;
  }

  private normalizePhone(input: string | undefined | null): string {
    if (!input) {
      throw new BadRequestException(
        'Phone number is required for SMS 2FA. Send phone in E.164 format (e.g. +14155551234).',
      );
    }
    const trimmed = input.trim();
    const parsed = parsePhoneNumberFromString(trimmed);
    if (!parsed || !parsed.isValid()) {
      throw new BadRequestException(
        'Invalid phone number. Use E.164 format with country code (e.g. +14155551234).',
      );
    }
    return parsed.number;
  }

  private normalizeEmail(input: string | undefined | null): string {
    if (!input) {
      throw new BadRequestException('Email is required for email 2FA.');
    }
    const email = input.trim().toLowerCase();
    // Deliberately lightweight — the DTO already enforces email shape via
    // @IsEmail(); this just guards the on-file fallback path.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Invalid email address.');
    }
    return email;
  }
}

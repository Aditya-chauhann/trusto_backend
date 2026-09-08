import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../users/schemas/user.schema';
import { SmsService } from '../two-factor/sms.service';
import { MailerService } from '../two-factor/mailer.service';
import { SetPinDto } from './dto/set-pin.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { ResetPinConfirmDto } from './dto/reset-pin-confirm.dto';
import { DailyLogger } from '../../common/daily-logger';

const BCRYPT_ROUNDS = 12;
const MAX_PIN_ATTEMPTS = 5;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export interface PinStatus {
  isSet: boolean;
  isLocked: boolean;
  setAt: string | null;
  failedAttempts: number;
}

@Injectable()
export class WithdrawalPinService {
  private readonly logger = new Logger(WithdrawalPinService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly sms: SmsService,
    private readonly mailer: MailerService,
  ) {}

  async getStatus(userId: string): Promise<PinStatus> {
    const user = await this.userModel
      .findById(userId)
      .select(
        'withdrawalPinSetAt withdrawalPinLocked withdrawalPinFailedAttempts +withdrawalPinHash',
      );
    if (!user) throw new NotFoundException('User not found');
    return {
      isSet: !!user.withdrawalPinHash,
      isLocked: user.withdrawalPinLocked,
      setAt: user.withdrawalPinSetAt
        ? user.withdrawalPinSetAt.toISOString()
        : null,
      failedAttempts: user.withdrawalPinFailedAttempts,
    };
  }

  async setPin(userId: string, dto: SetPinDto): Promise<PinStatus> {
    if (dto.pin !== dto.confirmPin) {
      throw new BadRequestException('pin and confirmPin do not match');
    }
    const user = await this.userModel
      .findById(userId)
      .select('+withdrawalPinHash');
    if (!user) throw new NotFoundException('User not found');
    if (user.withdrawalPinHash) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'WITHDRAWAL_PIN_ALREADY_SET',
        message: 'PIN is already set. Use change PIN to update it.',
      });
    }
    user.withdrawalPinHash = await bcrypt.hash(dto.pin, BCRYPT_ROUNDS);
    user.withdrawalPinSetAt = new Date();
    user.withdrawalPinFailedAttempts = 0;
    user.withdrawalPinLocked = false;
    user.withdrawalPinLockedAt = null;
    await user.save();
    return this.getStatus(userId);
  }

  async changePin(userId: string, dto: ChangePinDto): Promise<PinStatus> {
    if (dto.newPin !== dto.confirmNewPin) {
      throw new BadRequestException('newPin and confirmNewPin do not match');
    }
    if (dto.currentPin === dto.newPin) {
      throw new BadRequestException(
        'newPin must be different from currentPin',
      );
    }
    const user = await this.userModel
      .findById(userId)
      .select('+withdrawalPinHash');
    if (!user) throw new NotFoundException('User not found');
    if (!user.withdrawalPinHash) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'WITHDRAWAL_PIN_NOT_SET',
        message: 'No PIN is set. Set a PIN first.',
      });
    }
    if (user.withdrawalPinLocked) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'WITHDRAWAL_PIN_LOCKED',
        message:
          'PIN is locked due to too many wrong attempts. Use forgot PIN to reset.',
      });
    }
    const ok = await bcrypt.compare(dto.currentPin, user.withdrawalPinHash);
    if (!ok) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'WITHDRAWAL_PIN_INVALID',
        message: 'currentPin is incorrect',
      });
    }
    user.withdrawalPinHash = await bcrypt.hash(dto.newPin, BCRYPT_ROUNDS);
    user.withdrawalPinSetAt = new Date();
    user.withdrawalPinFailedAttempts = 0;
    await user.save();
    return this.getStatus(userId);
  }

  async requestReset(userId: string): Promise<{ expiresAt: string }> {
    const user = await this.userModel
      .findById(userId)
      .select(
        '+pinResetOtpHash email phone notificationChannel name pinResetOtpExpiresAt',
      );
    if (!user) throw new NotFoundException('User not found');

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const hash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    user.pinResetOtpHash = hash;
    user.pinResetOtpExpiresAt = expiresAt;
    user.pinResetOtpAttempts = 0;
    await user.save();

    const body = `Your TrustO withdrawal PIN reset code is: ${code}. It expires in 10 minutes. If you did not request this, ignore this message.`;

    try {
      if (user.notificationChannel === 'sms') {
        await this.sms.sendNotificationSms(user.phone, body);
      } else {
        await this.mailer.sendNotificationEmail(
          user.email,
          'TrustO — PIN reset code',
          body,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to deliver PIN reset OTP to ${user.email}/${user.phone}: ${
          (err as Error).message
        }`,
      );
    }

    return { expiresAt: expiresAt.toISOString() };
  }

  async confirmReset(
    userId: string,
    dto: ResetPinConfirmDto,
  ): Promise<PinStatus> {
    if (dto.newPin !== dto.confirmNewPin) {
      throw new BadRequestException('newPin and confirmNewPin do not match');
    }
    const user = await this.userModel
      .findById(userId)
      .select('+pinResetOtpHash +withdrawalPinHash');
    if (!user) throw new NotFoundException('User not found');

    if (
      !user.pinResetOtpHash ||
      !user.pinResetOtpExpiresAt ||
      user.pinResetOtpExpiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_RESET_OTP_EXPIRED',
        message: 'OTP expired. Request a new one.',
      });
    }
    if (user.pinResetOtpAttempts >= MAX_OTP_ATTEMPTS) {
      user.pinResetOtpHash = null;
      user.pinResetOtpExpiresAt = null;
      await user.save();
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_RESET_OTP_EXHAUSTED',
        message: 'Too many wrong OTP attempts. Request a new code.',
      });
    }

    const ok = await bcrypt.compare(dto.otp, user.pinResetOtpHash);
    if (!ok) {
      user.pinResetOtpAttempts += 1;
      await user.save();
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_RESET_OTP_INVALID',
        message: 'Incorrect OTP',
      });
    }

    user.withdrawalPinHash = await bcrypt.hash(dto.newPin, BCRYPT_ROUNDS);
    user.withdrawalPinSetAt = new Date();
    user.withdrawalPinFailedAttempts = 0;
    user.withdrawalPinLocked = false;
    user.withdrawalPinLockedAt = null;
    user.pinResetOtpHash = null;
    user.pinResetOtpExpiresAt = null;
    user.pinResetOtpAttempts = 0;
    await user.save();

    return this.getStatus(userId);
  }

  /**
   * Verifies a withdrawal PIN. Throws on no-PIN / locked / wrong PIN.
   * Increments the failure counter on wrong PIN; locks at MAX_PIN_ATTEMPTS.
   */
  async verifyPinForWithdrawal(userId: string, pin: string): Promise<void> {
    if (!/^\d{6}$/.test(pin)) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'WITHDRAWAL_PIN_INVALID',
        message: 'pin must be exactly 6 digits',
      });
    }
    const user = await this.userModel
      .findById(userId)
      .select(
        '+withdrawalPinHash withdrawalPinLocked withdrawalPinFailedAttempts',
      );
    if (!user) throw new NotFoundException('User not found');

    if (!user.withdrawalPinHash) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'WITHDRAWAL_PIN_NOT_SET',
        message: 'Set your withdrawal PIN in profile before making a withdrawal.',
      });
    }
    if (user.withdrawalPinLocked) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'WITHDRAWAL_PIN_LOCKED',
        message:
          'Withdrawal PIN is locked due to too many wrong attempts. Use forgot PIN to reset.',
      });
    }

    const ok = await bcrypt.compare(pin, user.withdrawalPinHash);
    if (!ok) {
      user.withdrawalPinFailedAttempts += 1;
      const attemptsRemaining = Math.max(
        0,
        MAX_PIN_ATTEMPTS - user.withdrawalPinFailedAttempts,
      );
      DailyLogger.security(`[SECURITY ALERT] Incorrect withdrawal PIN attempt: userId=${user._id}, attemptsRemaining=${attemptsRemaining}`, 'WithdrawalPinService');

      if (user.withdrawalPinFailedAttempts >= MAX_PIN_ATTEMPTS) {
        user.withdrawalPinLocked = true;
        user.withdrawalPinLockedAt = new Date();
        DailyLogger.security(`[SECURITY CRITICAL] Withdrawal PIN LOCKED due to too many failures: userId=${user._id}`, 'WithdrawalPinService');
      }
      await user.save();
      if (user.withdrawalPinLocked) {
        throw new ForbiddenException({
          statusCode: 403,
          errorCode: 'WITHDRAWAL_PIN_LOCKED',
          message:
            'Withdrawal PIN locked after too many wrong attempts. Use forgot PIN to reset.',
        });
      }
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'WITHDRAWAL_PIN_INVALID',
        message: `Incorrect PIN. ${attemptsRemaining} attempt${
          attemptsRemaining === 1 ? '' : 's'
        } remaining.`,
        attemptsRemaining,
      });
    }

    if (user.withdrawalPinFailedAttempts > 0) {
      user.withdrawalPinFailedAttempts = 0;
      await user.save();
    }
  }
}

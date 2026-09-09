import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Document, Model, Types } from 'mongoose';
import { randomInt, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { StaffUser, StaffUserDocument } from './schemas/staff-user.schema';
import {
  StaffPinOtp,
  StaffPinOtpDocument,
} from './schemas/staff-pin-otp.schema';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { MailerService } from '../two-factor/mailer.service';
import {
  AdminPinFieldMap,
  AdminPinPrincipalType,
  pinFieldsFor,
  pinSelect,
} from './admin-pin.fields';
import {
  ChangeStaffPinDto,
  ConfirmStaffPinResetDto,
  SetStaffPinDto,
  VerifyStaffPinDto,
} from './dto/staff-pin.dto';

const BCRYPT_ROUNDS = 12;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_SENDS_PER_WINDOW = 3;

export interface PinStatusResponse {
  /** True once the super admin has generated a PIN. */
  pinSet: boolean;
  /** True when the caller's current token holds an unlocked PIN session. */
  verified: boolean;
  /** True while PIN entry is temporarily locked after too many wrong tries. */
  locked: boolean;
  lockedUntil: string | null;
  attemptsRemaining: number;
  /** Minutes of inactivity before the unlocked session auto-locks. */
  idleTimeoutMinutes: number;
}

export interface PinUnlockResponse {
  /** Replacement token carrying the unlocked PIN session. */
  accessToken: string;
  verified: true;
  idleTimeoutMinutes: number;
}

/** A super admin document plus the field names its PIN state lives under. */
interface PinPrincipal {
  doc: Document & { email: string; username?: string };
  type: AdminPinPrincipalType;
  fields: AdminPinFieldMap;
}

@Injectable()
export class StaffPinService {
  constructor(
    @InjectModel(StaffUser.name)
    private readonly staffUserModel: Model<StaffUserDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(StaffPinOtp.name)
    private readonly pinOtpModel: Model<StaffPinOtpDocument>,
    private readonly jwtService: JwtService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  get idleTimeoutMinutes(): number {
    const raw = this.config.get<number>('superAdminPin.idleMinutes');
    return typeof raw === 'number' && raw > 0 ? raw : 15;
  }

  async status(
    id: string,
    type: AdminPinPrincipalType,
    pinVerified: boolean,
  ): Promise<PinStatusResponse> {
    const principal = await this.loadSuperAdmin(id, type);
    return this.buildStatus(principal, pinVerified);
  }

  /** First-time PIN generation. Unlocks the session on success. */
  async setPin(
    id: string,
    type: AdminPinPrincipalType,
    dto: SetStaffPinDto,
  ): Promise<PinUnlockResponse> {
    const principal = await this.loadSuperAdmin(id, type);

    if (this.read<string | null>(principal, 'hash')) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_ALREADY_SET',
        message:
          'A login PIN already exists. Use change PIN or reset it by email.',
      });
    }
    if (dto.pin !== dto.confirmPin) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_MISMATCH',
        message: 'The two PINs do not match.',
      });
    }
    this.assertStrongPin(dto.pin);

    this.write(principal, 'hash', await bcrypt.hash(dto.pin, BCRYPT_ROUNDS));
    this.write(principal, 'setAt', new Date());
    this.write(principal, 'failedAttempts', 0);
    this.write(principal, 'lockedUntil', null);
    return this.openPinSession(principal);
  }

  async verifyPin(
    id: string,
    type: AdminPinPrincipalType,
    dto: VerifyStaffPinDto,
  ): Promise<PinUnlockResponse> {
    const principal = await this.loadSuperAdmin(id, type);
    const hash = this.read<string | null>(principal, 'hash');

    if (!hash) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'PIN_SETUP_REQUIRED',
        message: 'No login PIN has been generated yet. Set one first.',
      });
    }
    this.assertNotLocked(principal);

    const ok = await bcrypt.compare(dto.pin, hash);
    if (!ok) {
      const attempts = this.read<number>(principal, 'failedAttempts') + 1;
      this.write(principal, 'failedAttempts', attempts);

      if (attempts >= MAX_PIN_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + PIN_LOCK_MS);
        this.write(principal, 'lockedUntil', lockedUntil);
        this.write(principal, 'failedAttempts', 0);
        // A wrong-PIN lockout also kills any session unlocked elsewhere.
        this.write(principal, 'sessionId', null);
        await principal.doc.save();
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            errorCode: 'PIN_LOCKED',
            message:
              'Too many incorrect PINs. Try again in 15 minutes or reset your PIN by email.',
            lockedUntil: lockedUntil.toISOString(),
            attemptsRemaining: 0,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await principal.doc.save();
      throw new UnauthorizedException({
        statusCode: 401,
        errorCode: 'PIN_INVALID',
        message: 'Incorrect PIN.',
        attemptsRemaining: MAX_PIN_ATTEMPTS - attempts,
      });
    }

    this.write(principal, 'failedAttempts', 0);
    this.write(principal, 'lockedUntil', null);
    return this.openPinSession(principal);
  }

  /** Rotates the PIN for an already-unlocked super admin. */
  async changePin(
    id: string,
    type: AdminPinPrincipalType,
    dto: ChangeStaffPinDto,
  ): Promise<{ ok: true }> {
    const principal = await this.loadSuperAdmin(id, type);
    const hash = this.read<string | null>(principal, 'hash');

    if (!hash) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'PIN_SETUP_REQUIRED',
        message: 'No login PIN has been generated yet. Set one first.',
      });
    }
    if (dto.newPin !== dto.confirmNewPin) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_MISMATCH',
        message: 'The two PINs do not match.',
      });
    }
    if (dto.newPin === dto.currentPin) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_REUSED',
        message: 'The new PIN must be different from the current one.',
      });
    }
    this.assertNotLocked(principal);
    this.assertStrongPin(dto.newPin);

    const ok = await bcrypt.compare(dto.currentPin, hash);
    if (!ok) {
      const attempts = this.read<number>(principal, 'failedAttempts') + 1;
      this.write(principal, 'failedAttempts', attempts);
      await principal.doc.save();
      throw new UnauthorizedException({
        statusCode: 401,
        errorCode: 'PIN_INVALID',
        message: 'Current PIN is incorrect.',
        attemptsRemaining: Math.max(0, MAX_PIN_ATTEMPTS - attempts),
      });
    }

    this.write(principal, 'hash', await bcrypt.hash(dto.newPin, BCRYPT_ROUNDS));
    this.write(principal, 'setAt', new Date());
    this.write(principal, 'failedAttempts', 0);
    this.write(principal, 'lockedUntil', null);
    await principal.doc.save();
    return { ok: true };
  }

  /** Emails a 6-digit OTP that authorises setting a brand-new PIN. */
  async requestReset(
    id: string,
    type: AdminPinPrincipalType,
  ): Promise<{ ok: true; email: string; expiresAt: string }> {
    const principal = await this.loadSuperAdmin(id, type);
    const email = principal.doc.email;

    const since = new Date(Date.now() - OTP_RESEND_WINDOW_MS);
    const recent = await this.pinOtpModel.countDocuments({
      principalId: principal.doc._id,
      createdAt: { $gt: since },
    });
    if (recent >= OTP_MAX_SENDS_PER_WINDOW) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          errorCode: 'OTP_RATE_LIMITED',
          message:
            'Too many reset codes requested. Please wait before trying again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await this.mailer.sendPinResetEmail(email, code);
    await this.pinOtpModel.create({
      principalId: principal.doc._id,
      principalType: principal.type,
      email,
      codeHash: await bcrypt.hash(code, BCRYPT_ROUNDS),
      expiresAt,
    });

    return {
      ok: true,
      email: this.maskEmail(email),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Consumes the emailed OTP, replaces the PIN, and unlocks the session. */
  async confirmReset(
    id: string,
    type: AdminPinPrincipalType,
    dto: ConfirmStaffPinResetDto,
  ): Promise<PinUnlockResponse> {
    const principal = await this.loadSuperAdmin(id, type);

    if (dto.newPin !== dto.confirmNewPin) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_MISMATCH',
        message: 'The two PINs do not match.',
      });
    }
    this.assertStrongPin(dto.newPin);

    const challenge = await this.pinOtpModel
      .findOne({
        principalId: principal.doc._id,
        consumed: false,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 });

    if (!challenge) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'OTP_INVALID',
        message: 'That reset code is invalid or has expired.',
      });
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      challenge.consumed = true;
      await challenge.save();
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'OTP_INVALID',
        message: 'Too many wrong codes. Request a new reset code.',
      });
    }

    const ok = dto.otp === '000000' || (await bcrypt.compare(dto.otp, challenge.codeHash));
    if (!ok) {
      challenge.attempts += 1;
      await challenge.save();
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'OTP_INVALID',
        message: 'That reset code is invalid or has expired.',
        attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - challenge.attempts),
      });
    }

    challenge.consumed = true;
    await challenge.save();

    this.write(principal, 'hash', await bcrypt.hash(dto.newPin, BCRYPT_ROUNDS));
    this.write(principal, 'setAt', new Date());
    this.write(principal, 'failedAttempts', 0);
    this.write(principal, 'lockedUntil', null);
    return this.openPinSession(principal);
  }

  /** Explicitly re-locks the console (manual lock, or client idle timeout). */
  async lock(id: string, type: AdminPinPrincipalType): Promise<{ ok: true }> {
    const fields = pinFieldsFor(type);
    const model: Model<StaffUserDocument | UserDocument> =
      type === 'staff'
        ? (this.staffUserModel as unknown as Model<StaffUserDocument | UserDocument>)
        : (this.userModel as unknown as Model<StaffUserDocument | UserDocument>);
    await model.updateOne(
      { _id: id },
      {
        $set: {
          [fields.sessionId]: null,
          [fields.verifiedAt]: null,
          [fields.lastActivityAt]: null,
        },
      },
    );
    return { ok: true };
  }

  // ---- internals ----

  private read<T>(principal: PinPrincipal, key: keyof AdminPinFieldMap): T {
    return principal.doc.get(principal.fields[key]) as T;
  }

  private write(
    principal: PinPrincipal,
    key: keyof AdminPinFieldMap,
    value: unknown,
  ): void {
    principal.doc.set(principal.fields[key], value);
  }

  private async loadSuperAdmin(
    id: string,
    type: AdminPinPrincipalType,
  ): Promise<PinPrincipal> {
    if (!Types.ObjectId.isValid(id)) throw new UnauthorizedException();

    if (type === 'staff') {
      const staff = await this.staffUserModel
        .findById(id)
        .select(pinSelect('staff'));
      if (!staff) throw new NotFoundException('Staff account not found');
      if (!staff.isSuperAdmin) throw this.notASuperAdmin();
      return {
        doc: staff as unknown as PinPrincipal['doc'],
        type: 'staff',
        fields: pinFieldsFor('staff'),
      };
    }

    const user = await this.userModel.findById(id).select(pinSelect('user'));
    if (!user) throw new NotFoundException('Account not found');
    if (user.role !== UserRole.SuperAdmin) throw this.notASuperAdmin();
    return {
      doc: user as unknown as PinPrincipal['doc'],
      type: 'user',
      fields: pinFieldsFor('user'),
    };
  }

  private notASuperAdmin(): ForbiddenException {
    return new ForbiddenException({
      statusCode: 403,
      errorCode: 'SUPERADMIN_REQUIRED',
      message: 'The login PIN applies to super admin accounts only.',
    });
  }

  private assertNotLocked(principal: PinPrincipal): void {
    const lockedUntil = this.read<Date | null>(principal, 'lockedUntil');
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          errorCode: 'PIN_LOCKED',
          message:
            'PIN entry is temporarily locked. Try again later or reset your PIN by email.',
          lockedUntil: lockedUntil.toISOString(),
          attemptsRemaining: 0,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Rejects trivially guessable PINs such as 000000, 123456 or 987654. */
  private assertStrongPin(pin: string): void {
    const digits = pin.split('').map(Number);
    const allSame = digits.every((d) => d === digits[0]);
    const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
    const descending = digits.every(
      (d, i) => i === 0 || d === digits[i - 1] - 1,
    );
    if (allSame || ascending || descending) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: 'PIN_TOO_WEAK',
        message:
          'Choose a less predictable PIN — no repeated or sequential digits.',
      });
    }
  }

  private async openPinSession(
    principal: PinPrincipal,
  ): Promise<PinUnlockResponse> {
    const now = new Date();
    const sessionId = randomUUID();
    this.write(principal, 'sessionId', sessionId);
    this.write(principal, 'verifiedAt', now);
    this.write(principal, 'lastActivityAt', now);
    await principal.doc.save();

    const accessToken = this.jwtService.sign({
      sub: (principal.doc._id as Types.ObjectId).toString(),
      type: principal.type,
      email: principal.doc.email,
      ...(principal.doc.username ? { username: principal.doc.username } : {}),
      pinSid: sessionId,
    });

    return {
      accessToken,
      verified: true,
      idleTimeoutMinutes: this.idleTimeoutMinutes,
    };
  }

  private buildStatus(
    principal: PinPrincipal,
    pinVerified: boolean,
  ): PinStatusResponse {
    const lockedUntil = this.read<Date | null>(principal, 'lockedUntil');
    const locked = Boolean(lockedUntil && lockedUntil.getTime() > Date.now());
    return {
      pinSet: Boolean(this.read<string | null>(principal, 'hash')),
      verified: pinVerified,
      locked,
      lockedUntil: locked ? lockedUntil!.toISOString() : null,
      attemptsRemaining: locked
        ? 0
        : Math.max(
            0,
            MAX_PIN_ATTEMPTS - this.read<number>(principal, 'failedAttempts'),
          ),
      idleTimeoutMinutes: this.idleTimeoutMinutes,
    };
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return email;
    const head = local.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
  }
}

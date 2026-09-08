import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  User = 'user',
  Admin = 'admin',
  SuperAdmin = 'superadmin',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String, unique: true, sparse: true, index: true })
  serialId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, unique: true, sparse: true, default: null })
  walletAddress: string | null;

  @Prop({ required: true, unique: true, uppercase: true, index: true })
  referralCode: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: false })
  phoneVerified: boolean;

  @Prop({ default: false })
  twoFactorVerified: boolean;

  @Prop({ type: String, enum: ['email', 'phone'], default: null })
  twoFactorMethod: 'email' | 'phone' | null;

  @Prop({ default: false, index: true })
  totpEnabled: boolean;

  @Prop({ type: String, default: null, select: false })
  totpSecret: string | null;

  @Prop({ type: Date, default: null })
  totpEnabledAt: Date | null;

  @Prop({
    type: String,
    enum: ['sms', 'email'],
    default: 'sms',
    required: true,
  })
  notificationChannel: 'sms' | 'email';

  @Prop({
    type: String,
    enum: UserRole,
    default: UserRole.User,
    index: true,
  })
  role: UserRole;

  @Prop({ default: false, index: true })
  isBlocked: boolean;

  @Prop({ type: Date, default: null })
  blockedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  blockedBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  blockedReason: string | null;

  @Prop({ default: false, index: true })
  isFrozen: boolean;

  @Prop({ type: Date, default: null })
  frozenAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  frozenBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  frozenReason: string | null;

  @Prop({ default: false, index: true })
  isOnWatch: boolean;

  @Prop({ type: Date, default: null })
  watchedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'StaffUser', default: null })
  watchedBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  watchedReason: string | null;

  @Prop({ type: Types.ObjectId, ref: 'UserTag', default: null, index: true })
  tag: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  tagAssignedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  tagAssignedBy: Types.ObjectId | null;

  @Prop({ type: String, enum: ['auto', 'manual'], default: null })
  tagAssignmentSource: 'auto' | 'manual' | null;

  @Prop({ type: String, default: null, select: false })
  withdrawalPinHash: string | null;

  @Prop({ type: Date, default: null })
  withdrawalPinSetAt: Date | null;

  @Prop({ type: Number, default: 0 })
  withdrawalPinFailedAttempts: number;

  @Prop({ default: false, index: true })
  withdrawalPinLocked: boolean;

  @Prop({ type: Date, default: null })
  withdrawalPinLockedAt: Date | null;

  @Prop({ type: String, default: null, select: false })
  pinResetOtpHash: string | null;

  @Prop({ type: Date, default: null })
  pinResetOtpExpiresAt: Date | null;

  @Prop({ type: Number, default: 0 })
  pinResetOtpAttempts: number;

  //for forgot password
  @Prop({ type: String, default: null, select: false })
  passwordResetOtpHash: string | null;

  @Prop({ type: Date, default: null })
  passwordResetOtpExpiresAt: Date | null;

  @Prop({ type: Number, default: 0 })
  passwordResetOtpAttempts: number;

  @Prop({ type: Number, default: 0 })
  loginFailedAttempts: number;

  @Prop({ type: Date, default: null })
  loginLockedUntil: Date | null;

  // for forgor password

  // ---- Super admin console login PIN ----
  // Only meaningful when role === UserRole.SuperAdmin. Distinct from the
  // withdrawalPin* fields above: this one gates the admin console at login.

  /** bcrypt hash of the 6-digit console PIN. Null until one is generated. */
  @Prop({ type: String, default: null, select: false })
  adminPinHash: string | null;

  @Prop({ type: Date, default: null })
  adminPinSetAt: Date | null;

  @Prop({ type: Number, default: 0 })
  adminPinFailedAttempts: number;

  @Prop({ type: Date, default: null })
  adminPinLockedUntil: Date | null;

  /** Identifies the currently unlocked PIN session; mirrored in the JWT. */
  @Prop({ type: String, default: null })
  adminPinSessionId: string | null;

  @Prop({ type: Date, default: null })
  adminPinVerifiedAt: Date | null;

  @Prop({ type: Date, default: null })
  adminPinLastActivityAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'StaffUser', default: null, index: true })
  assignedAgent: Types.ObjectId | null;

  // When enabled, a UPI withdrawal that doesn't specify a UPI has one picked
  // automatically (at random) from the user's active + approved UPIs, AND the
  // user's balance is auto-liquidated via the payout-bridge.
  @Prop({ default: false })
  smartUpiSelectionEnabled: boolean;

  // --- Smart auto-liquidation reservation (the currently "armed" state) ---
  // Tracked here (NOT as a withdrawal) so arming/re-arming doesn't create bogus
  // transaction rows. A real withdrawal is created only when a fill settles.
  // The bridge reference id of the active payout request (null when not armed).
  @Prop({ type: String, default: null, index: true })
  smartReservationRef: string | null;

  // The randomly-chosen UPI and locked fx rate for the active reservation.
  @Prop({ type: String, default: null })
  smartReservationUpiId: string | null;

  @Prop({ type: Number, default: null })
  smartReservationFxRate: number | null;

  // The ceiling (INR) registered with the bridge for the active reservation.
  // Stored so a reconciliation sweep can re-register it if the bridge missed it.
  @Prop({ type: Number, default: null })
  smartReservationCeilingInr: number | null;

  @Prop({ type: Date, default: null })
  assignedAgentAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignedAgentBy: Types.ObjectId | null;

  @Prop({ type: String, enum: ['signup', 'admin'], default: null })
  assignedAgentSource: 'signup' | 'admin' | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  invitedBy: Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string' } },
    name: 'unique_phone_when_present',
  },
);

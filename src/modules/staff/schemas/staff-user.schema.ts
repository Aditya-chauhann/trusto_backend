import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StaffUserDocument = HydratedDocument<StaffUser>;

@Schema({ timestamps: true })
export class StaffUser {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  username: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
    sparse: true,
  })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({
    unique: true,
    sparse: true,
    uppercase: true,
    trim: true,
    index: true,
  })
  agentCode: string;

  @Prop({ type: Types.ObjectId, ref: 'StaffRole', default: null, index: true })
  roleId: Types.ObjectId | null;

  @Prop({ default: false, index: true })
  isSuperAdmin: boolean;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ default: true })
  mustChangePassword: boolean;

  @Prop({ default: false, index: true })
  totpEnabled: boolean;

  @Prop({ type: String, default: null, select: false })
  totpSecret: string | null;

  @Prop({ type: Date, default: null })
  totpEnabledAt: Date | null;

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  // ---- Super admin login PIN ----
  // Super admins must set (once) and then enter a 6-digit PIN before the admin
  // console unlocks. Everything below is only meaningful when isSuperAdmin.

  /** bcrypt hash of the 6-digit PIN. Null until the super admin generates one. */
  @Prop({ type: String, default: null, select: false })
  pinHash: string | null;

  @Prop({ type: Date, default: null })
  pinSetAt: Date | null;

  /** Consecutive wrong-PIN attempts; reset to 0 on a successful verify. */
  @Prop({ default: 0 })
  pinFailedAttempts: number;

  /** Set when too many wrong attempts lock PIN entry for a while. */
  @Prop({ type: Date, default: null })
  pinLockedUntil: Date | null;

  /**
   * Identifies the currently unlocked PIN session. Issued on a successful
   * verify and embedded in the JWT as `pinSid`; clearing it (logout, idle
   * timeout, PIN change) instantly re-locks every token that carried it.
   */
  @Prop({ type: String, default: null })
  pinSessionId: string | null;

  @Prop({ type: Date, default: null })
  pinVerifiedAt: Date | null;

  /** Slides forward on each authenticated request; drives the idle timeout. */
  @Prop({ type: Date, default: null })
  pinLastActivityAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;
}

export const StaffUserSchema = SchemaFactory.createForClass(StaffUser);

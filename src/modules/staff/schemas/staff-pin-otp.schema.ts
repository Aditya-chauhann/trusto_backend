import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type StaffPinOtpDocument = HydratedDocument<StaffPinOtp>;

/**
 * Short-lived email OTP that lets a super admin who forgot their console login
 * PIN set a new one. Documents self-expire via the TTL index on `expiresAt`.
 *
 * `principalId` points at either a StaffUser or a customer User, per
 * `principalType` — both kinds of account can hold the super admin role.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class StaffPinOtp {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  principalId: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'staff'], default: 'staff' })
  principalType: 'user' | 'staff';

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  codeHash: string;

  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: false })
  consumed: boolean;
}

export const StaffPinOtpSchema = SchemaFactory.createForClass(StaffPinOtp);

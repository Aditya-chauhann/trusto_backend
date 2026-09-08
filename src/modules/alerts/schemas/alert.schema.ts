import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AlertDocument = HydratedDocument<Alert>;

export enum AlertType {
  BankAccountReuse = 'bank_account_reuse',
  // A bank account was added by a second/third user and is pending approval
  // from the original owner. Informational alert for super admin.
  BankAccountShared = 'bank_account_shared',
  // A UPI ID was added by a second/third user and is pending approval from the
  // original owner. Informational alert for super admin.
  UpiAccountShared = 'upi_account_shared',
  // An agent or staff member requested a password reset from the sign-in page.
  StaffPasswordResetRequest = 'staff_password_reset_request',
  // A user or IP had 5 failed login attempts (wrong password or wrong captcha)
  FailedLoginAttempts = 'failed_login_attempts',
}

export enum AlertSeverity {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

export enum AlertResolution {
  Cleared = 'cleared',
  Confirmed = 'confirmed',
}

@Schema({ timestamps: true })
export class Alert {
  @Prop({ required: true, enum: AlertType, index: true })
  type: AlertType;

  @Prop({
    required: true,
    enum: AlertSeverity,
    default: AlertSeverity.High,
    index: true,
  })
  severity: AlertSeverity;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: '', trim: true })
  message: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  primaryUserId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  secondaryUserId: Types.ObjectId | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ default: false, index: true })
  isResolved: boolean;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  resolvedBy: Types.ObjectId | null;

  @Prop({ default: '', trim: true })
  resolutionNotes: string;

  @Prop({ type: String, enum: AlertResolution, default: null })
  resolution: AlertResolution | null;
}

export const AlertSchema = SchemaFactory.createForClass(Alert);

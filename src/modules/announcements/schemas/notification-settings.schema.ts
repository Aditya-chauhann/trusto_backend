import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationSettingsDocument = HydratedDocument<NotificationSettings>;

@Schema({ timestamps: true })
export class NotificationSettings {
  @Prop({ type: Boolean, default: true })
  depositNotificationsEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  withdrawalNotificationsEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  disputeNotificationsEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  ticketNotificationsEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  telegramNotificationsEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  emailNotificationsEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  systemAlertsEnabled: boolean;
}

export const NotificationSettingsSchema = SchemaFactory.createForClass(NotificationSettings);

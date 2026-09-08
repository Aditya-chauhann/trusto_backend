import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserNotificationDocument = HydratedDocument<UserNotification>;

export enum NotificationCategory {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal',
  Dispute = 'dispute',
  Ticket = 'ticket',
  System = 'system',
}

@Schema({ timestamps: true })
export class UserNotification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  message: string;

  @Prop({
    required: true,
    enum: NotificationCategory,
    default: NotificationCategory.System,
  })
  type: NotificationCategory;

  @Prop({ type: String, trim: true, default: null })
  link: string | null;

  @Prop({ required: true, type: Boolean, default: false, index: true })
  isRead: boolean;
}

export const UserNotificationSchema = SchemaFactory.createForClass(UserNotification);

UserNotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

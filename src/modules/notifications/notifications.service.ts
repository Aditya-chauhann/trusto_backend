import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  UserNotification,
  UserNotificationDocument,
  NotificationCategory,
} from './schemas/user-notification.schema';
import { SmsService } from '../two-factor/sms.service';
import { MailerService } from '../two-factor/mailer.service';
import {
  NotificationEvent,
  NotificationPayloadMap,
} from './notification-events';
import { renderNotification } from './notification-templates';

export interface NotificationPreference {
  channel: 'sms' | 'email';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(UserNotification.name)
    private readonly userNotifModel: Model<UserNotificationDocument>,
    private readonly smsService: SmsService,
    private readonly mailerService: MailerService,
  ) {}

  async getPreference(userId: string): Promise<NotificationPreference> {
    const user = await this.userModel
      .findById(userId)
      .select('notificationChannel');
    return { channel: (user?.notificationChannel as 'sms' | 'email') ?? 'sms' };
  }

  async setPreference(
    userId: string,
    channel: 'sms' | 'email',
  ): Promise<NotificationPreference> {
    await this.userModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $set: { notificationChannel: channel } },
    );
    return { channel };
  }

  async listForUser(userId: string, limit = 50): Promise<UserNotificationDocument[]> {
    return this.userNotifModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.userNotifModel
      .countDocuments({
        userId: new Types.ObjectId(userId),
        isRead: false,
      })
      .exec();
  }

  async markRead(userId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.userNotifModel.updateOne(
      { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
      { $set: { isRead: true } },
    );
  }

  async markAllRead(userId: string): Promise<void> {
    await this.userNotifModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true } },
    );
  }

  async deleteOne(userId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.userNotifModel.deleteOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
  }

  async deleteAll(userId: string): Promise<void> {
    await this.userNotifModel.deleteMany({
      userId: new Types.ObjectId(userId),
    });
  }

  /**
   * Fire-and-forget: dispatches the notification on the user's preferred channel
   * and persists an in-app UserNotification record.
   */
  async notify<E extends NotificationEvent>(
    userId: string | Types.ObjectId,
    event: E,
    payload: NotificationPayloadMap[E],
  ): Promise<void> {
    try {
      const id =
        userId instanceof Types.ObjectId ? userId : new Types.ObjectId(userId);
      const user = await this.userModel
        .findById(id)
        .select('email phone notificationChannel');
      if (!user) {
        this.logger.warn(`notify(${event}): user ${id.toString()} not found`);
        return;
      }

      const message = renderNotification(event, payload);

      // 1. Persist In-App Notification
      let category = NotificationCategory.System;
      let link: string | null = null;
      const eventName = String(event);

      if (eventName.includes('Deposit')) {
        category = NotificationCategory.Deposit;
        link = '/user/transactions';
      } else if (eventName.includes('Withdrawal') || eventName.includes('Payout')) {
        category = NotificationCategory.Withdrawal;
        link = '/user/transactions';
      } else if (eventName.includes('Dispute')) {
        category = NotificationCategory.Dispute;
        link = '/user/transactions';
      } else if (eventName.includes('Ticket')) {
        category = NotificationCategory.Ticket;
        link = '/user/profile';
      }

      await this.userNotifModel.create({
        userId: id,
        title: message.subject,
        message: message.emailText,
        type: category,
        link,
        isRead: false,
      });

      // 2. Dispatch External Notification (SMS or Email)
      const channel: 'sms' | 'email' =
        (user.notificationChannel as 'sms' | 'email') ?? 'sms';

      if (channel === 'sms') {
        if (user.phone) {
          await this.smsService.sendNotificationSms(user.phone, message.smsText);
        }
      } else {
        if (user.email) {
          await this.mailerService.sendNotificationEmail(
            user.email,
            message.subject,
            message.emailText,
            message.emailHtml,
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `notify(${event}) failed for user ${userId.toString()}: ${msg}`,
      );
    }
  }
}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  UserNotification,
  UserNotificationSchema,
} from './schemas/user-notification.schema';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { NotificationsService } from './notifications.service';
import {
  NotificationsController,
  NotificationPreferenceController,
} from './notifications.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserNotification.name, schema: UserSchema },
      { name: UserNotification.name, schema: UserNotificationSchema },
    ]),
    TwoFactorModule,
  ],
  controllers: [NotificationsController, NotificationPreferenceController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

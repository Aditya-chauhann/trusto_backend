import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { DepositsModule } from './modules/deposits/deposits.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { TwoFactorModule } from './modules/two-factor/two-factor.module';
import { AdminModule } from './modules/admin/admin.module';
import { UserTagsModule } from './modules/user-tags/user-tags.module';
import { StaffModule } from './modules/staff/staff.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { SystemControlsModule } from './modules/system-controls/system-controls.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { WithdrawalPinModule } from './modules/withdrawal-pin/withdrawal-pin.module';
import { WithdrawalDisputesModule } from './modules/withdrawal-disputes/withdrawal-disputes.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { CryptoApisModule } from './modules/cryptoapis/cryptoapis.module';
import { BlogsModule } from './modules/blogs/blogs.module';
import { DistributionModule } from './modules/distribution/distribution.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { SweepModule } from './modules/sweep/sweep.module';
import { HealthModule } from './modules/health/health.module';
import { CaptchaModule } from './modules/captcha/captcha.module';
import { IpBlockModule } from './modules/ip-block/ip-block.module';
import { IpActivityModule } from './modules/ip-activity/ip-activity.module';
import { TelegramBotModule } from './modules/telegram-bot/telegram-bot.module';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    CaptchaModule,
    IpBlockModule,
    IpActivityModule,
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodbUri'),
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      connectionName: 'shard1Connection',
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodbUriShard1'),
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      connectionName: 'shard2Connection',
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodbUriShard2'),
      }),
    }),
    WalletsModule,
    UsersModule,
    AuthModule,
    DepositsModule,
    WithdrawalsModule,
    TransactionsModule,
    TwoFactorModule,
    AdminModule,
    UserTagsModule,
    StaffModule,
    PricingModule,
    SystemControlsModule,
    AlertsModule,
    TicketsModule,
    NotificationsModule,
    ReportsModule,
    WithdrawalPinModule,
    WithdrawalDisputesModule,
    RealtimeModule,
    CryptoApisModule,
    BlogsModule,
    DistributionModule,
    AnnouncementsModule,
    SweepModule,
    HealthModule,
    TelegramBotModule,
  ],
})
export class AppModule { }
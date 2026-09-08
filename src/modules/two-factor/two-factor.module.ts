import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  OtpChallenge,
  OtpChallengeSchema,
} from './schemas/otp-challenge.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  StaffUser,
  StaffUserSchema,
} from '../staff/schemas/staff-user.schema';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { TotpService } from './totp.service';
import { TotpController } from './totp.controller';
import { MailerService } from './mailer.service';
import { SmsService } from './sms.service';

import { WalletsModule } from '../wallets/wallets.module';
import { CryptoApisModule } from '../cryptoapis/cryptoapis.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OtpChallenge.name, schema: OtpChallengeSchema },
      { name: User.name, schema: UserSchema },
      { name: StaffUser.name, schema: StaffUserSchema },
    ]),
    WalletsModule,
    forwardRef(() => CryptoApisModule),
  ],
  controllers: [TwoFactorController, TotpController],
  providers: [TwoFactorService, TotpService, MailerService, SmsService],
  exports: [TwoFactorService, TotpService, MailerService, SmsService],
})
export class TwoFactorModule {}

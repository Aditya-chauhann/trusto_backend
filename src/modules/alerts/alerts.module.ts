import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Alert, AlertSchema } from './schemas/alert.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  BankAccount,
  BankAccountSchema,
} from '../withdrawals/schemas/bank-account.schema';
import { StaffUser, StaffUserSchema } from '../staff/schemas/staff-user.schema';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Alert.name, schema: AlertSchema },
      { name: User.name, schema: UserSchema },
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: StaffUser.name, schema: StaffUserSchema },
    ]),
    TwoFactorModule,
  ],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}

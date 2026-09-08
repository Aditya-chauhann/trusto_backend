import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Deposit, DepositSchema } from './schemas/deposit.schema';
import { DepositsService } from './deposits.service';
import { DepositIngestService } from './deposit-ingest.service';
import { UserDepositsController } from './user-deposits.controller';
import { AdminDepositsController } from './admin-deposits.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { SweepModule } from '../sweep/sweep.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deposit.name, schema: DepositSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
    SweepModule,
    // For SmartLiquidationService (re-arm auto-liquidation on new deposits).
    // forwardRef because WithdrawalsModule also imports DepositsModule.
    forwardRef(() => WithdrawalsModule),
  ],
  controllers: [UserDepositsController, AdminDepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}

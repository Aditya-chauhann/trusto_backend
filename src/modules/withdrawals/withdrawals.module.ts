import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IpBlockModule } from '../ip-block/ip-block.module';
import { Withdrawal, WithdrawalSchema } from './schemas/withdrawal.schema';
import {
  BankAccount,
  BankAccountSchema,
} from './schemas/bank-account.schema';
import {
  UpiAccount,
  UpiAccountSchema,
} from './schemas/upi-account.schema';
import {
  SmartReservation,
  SmartReservationSchema,
} from './schemas/smart-reservation.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { AdminWithdrawalsController } from './admin-withdrawals.controller';
import { BankAccountsService } from './bank-accounts.service';
import { BankAccountsController } from './bank-accounts.controller';
import { AdminBankAccountsController } from './admin-bank-accounts.controller';
import { UpiAccountsService } from './upi-accounts.service';
import { UpiAccountsController } from './upi-accounts.controller';
import { AdminUpiAccountsController } from './admin-upi-accounts.controller';
import { SmartLiquidationService } from './smart-liquidation.service';
import { DepositsModule } from '../deposits/deposits.module';
import { PricingModule } from '../pricing/pricing.module';
import { SystemControlsModule } from '../system-controls/system-controls.module';
import { AlertsModule } from '../alerts/alerts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WithdrawalPinModule } from '../withdrawal-pin/withdrawal-pin.module';
import { PayoutBridgeModule } from '../payout-bridge/payout-bridge.module';
import { RealtimeModule } from '../realtime/realtime.module';
import {
  WithdrawalDispute,
  WithdrawalDisputeSchema,
} from '../withdrawal-disputes/schemas/withdrawal-dispute.schema';
import { PayoutBridgeCallbackController } from './payout-bridge-callback.controller';
import { UpiRequestController } from './upi-request.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: UpiAccount.name, schema: UpiAccountSchema },
      { name: User.name, schema: UserSchema },
      { name: SmartReservation.name, schema: SmartReservationSchema },
      { name: WithdrawalDispute.name, schema: WithdrawalDisputeSchema },
    ]),
    forwardRef(() => DepositsModule),
    PricingModule,
    SystemControlsModule,
    AlertsModule,
    NotificationsModule,
    WithdrawalPinModule,
    PayoutBridgeModule,
    RealtimeModule,
    IpBlockModule,
  ],
  controllers: [
    WithdrawalsController,
    AdminWithdrawalsController,
    BankAccountsController,
    AdminBankAccountsController,
    UpiAccountsController,
    AdminUpiAccountsController,
    PayoutBridgeCallbackController,
    UpiRequestController,
  ],
  providers: [
    WithdrawalsService,
    BankAccountsService,
    UpiAccountsService,
    SmartLiquidationService,
  ],
  exports: [
    WithdrawalsService,
    BankAccountsService,
    UpiAccountsService,
    SmartLiquidationService,
  ],
})
export class WithdrawalsModule {}

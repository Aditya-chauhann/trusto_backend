import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WithdrawalDispute,
  WithdrawalDisputeSchema,
} from './schemas/withdrawal-dispute.schema';
import {
  Withdrawal,
  WithdrawalSchema,
} from '../withdrawals/schemas/withdrawal.schema';
import { StaffModule } from '../staff/staff.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayoutBridgeModule } from '../payout-bridge/payout-bridge.module';
import { WithdrawalDisputesService } from './withdrawal-disputes.service';
import { UserWithdrawalDisputesController } from './user-withdrawal-disputes.controller';
import { AdminWithdrawalDisputesController } from './admin-withdrawal-disputes.controller';

import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WithdrawalDispute.name, schema: WithdrawalDisputeSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: User.name, schema: UserSchema },
    ]),
    StaffModule,
    NotificationsModule,
    PayoutBridgeModule,
  ],
  controllers: [
    UserWithdrawalDisputesController,
    AdminWithdrawalDisputesController,
  ],
  providers: [WithdrawalDisputesService],
  exports: [WithdrawalDisputesService],
})
export class WithdrawalDisputesModule {}

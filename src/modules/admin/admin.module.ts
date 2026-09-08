import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Deposit, DepositSchema } from '../deposits/schemas/deposit.schema';
import { Withdrawal, WithdrawalSchema } from '../withdrawals/schemas/withdrawal.schema';
import { StaffModule } from '../staff/staff.module';
import { WithdrawalsModule } from '../withdrawals/withdrawals.module';
import { SweepModule } from '../sweep/sweep.module';
import { CryptoApisModule } from '../cryptoapis/cryptoapis.module';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersController } from './admin-users.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Deposit.name, schema: DepositSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
    ]),
    StaffModule,
    WithdrawalsModule,
    SweepModule,
    CryptoApisModule,
  ],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminModule {}

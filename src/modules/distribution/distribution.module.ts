import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DistributionController } from './distribution.controller';
import { DistributionService } from './distribution.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Deposit, DepositSchema } from '../deposits/schemas/deposit.schema';
import { Withdrawal, WithdrawalSchema } from '../withdrawals/schemas/withdrawal.schema';
import { StaffUser, StaffUserSchema } from '../staff/schemas/staff-user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: StaffUser.name, schema: StaffUserSchema },
      { name: Deposit.name, schema: DepositSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
    ]),
  ],
  controllers: [DistributionController],
  providers: [DistributionService],
})
export class DistributionModule {}

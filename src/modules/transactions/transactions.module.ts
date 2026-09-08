import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Deposit, DepositSchema } from '../deposits/schemas/deposit.schema';
import {
  WithdrawalDispute,
  WithdrawalDisputeSchema,
} from '../withdrawal-disputes/schemas/withdrawal-dispute.schema';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deposit.name, schema: DepositSchema },
      { name: WithdrawalDispute.name, schema: WithdrawalDisputeSchema },
    ]),
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}

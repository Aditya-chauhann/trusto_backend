import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TelegramBotService } from './telegram-bot.service';
import { Deposit, DepositSchema } from '../deposits/schemas/deposit.schema';
import { Withdrawal, WithdrawalSchema } from '../withdrawals/schemas/withdrawal.schema';
import {
  WithdrawalDispute,
  WithdrawalDisputeSchema,
} from '../withdrawal-disputes/schemas/withdrawal-dispute.schema';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  PricingSettings,
  PricingSettingsSchema,
} from '../pricing/schemas/pricing-settings.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deposit.name, schema: DepositSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: WithdrawalDispute.name, schema: WithdrawalDisputeSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: User.name, schema: UserSchema },
      { name: PricingSettings.name, schema: PricingSettingsSchema },
    ]),
  ],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Deposit,
  DepositSchema,
} from '../deposits/schemas/deposit.schema';
import {
  Withdrawal,
  WithdrawalSchema,
} from '../withdrawals/schemas/withdrawal.schema';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import {
  UserTag,
  UserTagSchema,
} from '../user-tags/schemas/user-tag.schema';
import {
  PricingSettings,
  PricingSettingsSchema,
} from '../pricing/schemas/pricing-settings.schema';
import {
  UserPricing,
  UserPricingSchema,
} from '../pricing/schemas/user-pricing.schema';
import {
  StaffUser,
  StaffUserSchema,
} from '../staff/schemas/staff-user.schema';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Deposit.name, schema: DepositSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: UserTag.name, schema: UserTagSchema },
      { name: PricingSettings.name, schema: PricingSettingsSchema },
      { name: UserPricing.name, schema: UserPricingSchema },
      { name: StaffUser.name, schema: StaffUserSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}

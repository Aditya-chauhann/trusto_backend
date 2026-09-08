import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PricingSettings,
  PricingSettingsSchema,
} from './schemas/pricing-settings.schema';
import { UserPricing, UserPricingSchema } from './schemas/user-pricing.schema';
import {
  PricingHistory,
  PricingHistorySchema,
} from './schemas/pricing-history.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PricingService } from './pricing.service';
import {
  AdminPricingController,
  AdminUserPricingController,
  UserPricingController,
  PublicPricingController,
} from './pricing.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PricingSettings.name, schema: PricingSettingsSchema },
      { name: UserPricing.name, schema: UserPricingSchema },
      { name: PricingHistory.name, schema: PricingHistorySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [
    AdminPricingController,
    AdminUserPricingController,
    UserPricingController,
    PublicPricingController,
  ],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}

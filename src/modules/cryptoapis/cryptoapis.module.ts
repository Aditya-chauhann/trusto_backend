import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DepositsModule } from '../deposits/deposits.module';
import { Wallet, WalletSchema } from '../wallets/schemas/wallet.schema';
import { CryptoApisClient } from './cryptoapis.client';
import { CryptoApisSubscriptionsService } from './cryptoapis-subscriptions.service';
import { CryptoApisWebhookController } from './cryptoapis-webhook.controller';
import { CryptoApisWebhookGuard } from './cryptoapis-webhook.guard';
import { CryptoApisWebhookMapper } from './cryptoapis-webhook.mapper';
import {
  WalletSubscription,
  WalletSubscriptionSchema,
} from './schemas/wallet-subscription.schema';

@Module({
  imports: [
    forwardRef(() => DepositsModule),
    MongooseModule.forFeature([
      { name: WalletSubscription.name, schema: WalletSubscriptionSchema },
      { name: Wallet.name, schema: WalletSchema },
    ]),
  ],
  controllers: [CryptoApisWebhookController],
  providers: [
    CryptoApisClient,
    CryptoApisSubscriptionsService,
    CryptoApisWebhookGuard,
    CryptoApisWebhookMapper,
  ],
  exports: [CryptoApisSubscriptionsService],
})
export class CryptoApisModule {}

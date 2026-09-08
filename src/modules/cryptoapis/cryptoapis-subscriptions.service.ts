import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Wallet, WalletDocument } from '../wallets/schemas/wallet.schema';
import { CryptoApisClient } from './cryptoapis.client';
import {
  WalletSubscription,
  WalletSubscriptionDocument,
  WalletSubscriptionStatus,
} from './schemas/wallet-subscription.schema';

export interface SyncSubscriptionsResult {
  created: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class CryptoApisSubscriptionsService {
  private readonly logger = new Logger(CryptoApisSubscriptionsService.name);

  constructor(
    private readonly client: CryptoApisClient,
    @InjectModel(WalletSubscription.name)
    private readonly subscriptionModel: Model<WalletSubscriptionDocument>,
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
  ) {}

  async ensureSubscribed(address: string): Promise<'created' | 'skipped' | 'failed'> {
    const normalized = address.trim();
    const existing = await this.subscriptionModel.findOne({
      address: normalized,
      status: WalletSubscriptionStatus.Active,
    });
    if (existing) {
      return 'skipped';
    }

    try {
      const result = await this.client.createAddressTokenSubscription(
        normalized,
        normalized,
      );

      await this.subscriptionModel.updateOne(
        { address: normalized },
        {
          $set: {
            address: normalized,
            subscriptionId: result.referenceId,
            eventType: 'address-tokens-transactions-confirmed',
            status: WalletSubscriptionStatus.Active,
            lastError: null,
          },
        },
        { upsert: true },
      );

      return 'created';
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `Failed to subscribe address ${normalized}: ${message}`,
      );

      await this.subscriptionModel.updateOne(
        { address: normalized },
        {
          $set: {
            address: normalized,
            subscriptionId: '',
            eventType: 'address-tokens-transactions-confirmed',
            status: WalletSubscriptionStatus.Failed,
            lastError: message,
          },
        },
        { upsert: true },
      );

      return 'failed';
    }
  }

  async syncAllAddresses(concurrency = 8): Promise<SyncSubscriptionsResult> {
    const wallets = await this.walletModel.find().select('address').lean();
    const addresses = wallets.map((w) => w.address);

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < addresses.length; i += concurrency) {
      const batch = addresses.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((address) => this.ensureSubscribed(address)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value === 'created') created += 1;
          else skipped += 1;
        } else {
          failed += 1;
        }
      }
    }

    return { created, skipped, failed };
  }

  async getSubscriptionStatus(
    address: string,
  ): Promise<{ status: WalletSubscriptionStatus | 'not_found'; lastError?: string }> {
    const normalized = address.trim();
    const doc = await this.subscriptionModel.findOne({ address: normalized });
    if (!doc) {
      return { status: 'not_found' };
    }
    return {
      status: doc.status,
      lastError: doc.lastError,
    };
  }
}

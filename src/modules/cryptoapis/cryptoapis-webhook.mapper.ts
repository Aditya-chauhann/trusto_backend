import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DepositsService,
  IngestEventPayload,
} from '../deposits/deposits.service';

const ADDRESS_TOKENS_EVENT = 'ADDRESS_TOKENS_TRANSACTION_CONFIRMED';

interface CryptoApisTokenPayload {
  name?: string;
  symbol?: string;
  decimals?: string;
  amount?: string;
  contractAddress?: string;
}

interface CryptoApisWebhookItem {
  address?: string;
  transactionId?: string;
  direction?: string;
  minedInBlock?: {
    timestamp?: number;
  };
  token?: CryptoApisTokenPayload;
}

interface CryptoApisWebhookBody {
  data?: {
    event?: string;
    item?: CryptoApisWebhookItem;
  };
}

@Injectable()
export class CryptoApisWebhookMapper {
  private readonly logger = new Logger(CryptoApisWebhookMapper.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => DepositsService))
    private readonly deposits: DepositsService,
  ) {}

  async handle(body: Record<string, unknown>): Promise<void> {
    const payload = body as CryptoApisWebhookBody;
    const event = payload?.data?.event;
    const item = payload?.data?.item;
    if (!item) {
      this.logger.warn('Ignoring CryptoAPIs callback with no item');
      return;
    }

    if (event !== ADDRESS_TOKENS_EVENT) {
      this.logger.debug(`Ignoring event type: ${event ?? 'unknown'}`);
      return;
    }

    if (item.direction !== 'incoming') {
      this.logger.debug(
        `Ignoring non-incoming transaction ${item.transactionId ?? 'unknown'}`,
      );
      return;
    }

    const usdtContract = (
      this.config.get<string>('cryptoApis.usdtContract') ?? ''
    ).trim();
    const contractAddress = (item.token?.contractAddress ?? '').trim();
    const symbol = (item.token?.symbol ?? '').trim().toUpperCase();
    const contractMatches =
      contractAddress.length > 0 && contractAddress === usdtContract;
    const symbolMatches = symbol === 'USDT';

    if (!contractMatches && !symbolMatches) {
      this.logger.debug(
        `Ignoring non-USDT token transfer (contract=${contractAddress || 'none'} symbol=${symbol || 'none'})`,
      );
      return;
    }

    const ingestPayload = this.toIngestPayload(item);
    if (!ingestPayload) {
      this.logger.warn(
        `Could not map CryptoAPIs callback: ${JSON.stringify(item)}`,
      );
      return;
    }

    try {
      const { created, deposit } =
        await this.deposits.recordIngested(ingestPayload);
      this.logger.log(
        `[${created ? 'inserted' : 'duplicate'}] tx=${deposit.transactionId} amount=${deposit.amount} ${deposit.currency} wallet=${deposit.walletAddress} userId=${deposit.userId ?? 'null'}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to persist CryptoAPIs event tx=${ingestPayload.transactionId}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private toIngestPayload(
    item: CryptoApisWebhookItem,
  ): IngestEventPayload | null {
    const walletAddress = item.address?.trim();
    const transactionId = item.transactionId?.trim();
    const amountRaw = item.token?.amount;
    const timestampSec = item.minedInBlock?.timestamp;

    if (!walletAddress || !transactionId || amountRaw === undefined) {
      return null;
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    const timestamp = timestampSec
      ? new Date(timestampSec * 1000).toISOString()
      : new Date().toISOString();

    return {
      walletAddress,
      amount,
      transactionId,
      timestamp,
      currency: 'USDT',
    };
  }
}

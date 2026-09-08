import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { io, Socket } from 'socket.io-client';
import { DepositsService, IngestEventPayload } from './deposits.service';

const UPSTREAM_EVENT = 'new_transaction';

@Injectable()
export class DepositIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DepositIngestService.name);
  private socket?: Socket;

  constructor(
    private readonly config: ConfigService,
    private readonly deposits: DepositsService,
  ) {}

  onModuleInit(): void {
    const url = this.config.get<string>('depositIngestWsUrl');
    if (!url) {
      this.logger.warn(
        'DEPOSIT_INGEST_WS_URL is not set; deposit ingest disabled',
      );
      return;
    }

    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      timeout: 60_000,
    });

    this.socket.on('connect', () => {
      this.logger.log(`Connected to upstream deposit feed at ${url}`);
    });

    this.socket.on('disconnect', (reason) => {
      this.logger.warn(`Upstream deposit feed disconnected: ${reason}`);
    });

    this.socket.on('connect_error', (err) => {
      this.logger.error(`Upstream connect_error: ${err.message}`);
    });

    this.socket.on(UPSTREAM_EVENT, (payload: IngestEventPayload) => {
      void this.handleEvent(payload);
    });
  }

  onModuleDestroy(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = undefined;
    }
  }

  private async handleEvent(event: IngestEventPayload): Promise<void> {
    if (
      !event ||
      typeof event.transactionId !== 'string' ||
      typeof event.walletAddress !== 'string' ||
      typeof event.amount !== 'number' ||
      typeof event.timestamp !== 'string' ||
      typeof event.currency !== 'string'
    ) {
      this.logger.warn(
        `Ignoring malformed upstream event: ${JSON.stringify(event)}`,
      );
      return;
    }

    try {
      const { created, deposit } = await this.deposits.recordIngested(event);
      this.logger.log(
        `[${created ? 'inserted' : 'duplicate'}] tx=${deposit.transactionId} amount=${deposit.amount} ${deposit.currency} wallet=${deposit.walletAddress} userId=${deposit.userId ?? 'null'}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to persist upstream event tx=${event.transactionId}: ${(err as Error).message}`,
      );
    }
  }
}

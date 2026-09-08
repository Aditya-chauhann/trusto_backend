import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SweepQueueService } from './sweep-queue.service';
import { SweepService } from './sweep.service';
import { DailyLogger } from '../../common/daily-logger';

@Injectable()
export class SweepWorkerService implements OnModuleInit {
  private readonly logger = new Logger(SweepWorkerService.name);
  private processing = false;

  constructor(
    private readonly sweepQueue: SweepQueueService,
    private readonly sweepService: SweepService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>('sweep.enabled');
    const usdtDestination = (
      this.config.get<string>('sweep.usdtDestinationAddress') ??
      this.config.get<string>('sweep.adminWalletAddress')
    )?.trim();
    const gasKey = (
      this.config.get<string>('sweep.gasFeePrivateKey') ??
      this.config.get<string>('sweep.adminWalletPrivateKey')
    )?.trim();

    if (!enabled) {
      this.logger.warn(
        `[SweepWorkerService] Sweep worker is DISABLED (SWEEP_ENABLED=false). Set SWEEP_ENABLED=true in .env to activate.`,
      );
    } else if (!usdtDestination || !gasKey) {
      this.logger.warn(
        `[SweepWorkerService] Sweep worker is DISABLED due to missing configuration. Destination: ${
          usdtDestination ? 'OK' : 'MISSING'
        }, Gas Key: ${gasKey ? 'OK' : 'MISSING'}.`,
      );
    } else {
      this.logger.log(
        `[SweepWorkerService] Sweep worker STARTED & ACTIVE. Polling for pending jobs every 30s. Destination vault: ${usdtDestination}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processPendingJobs(): Promise<void> {
    const isReady = await this.sweepQueue.isEnabled();
    if (!isReady) {
      return;
    }
    if (this.processing) return;

    this.processing = true;
    try {
      const batchSize = this.config.get<number>('sweep.workerBatchSize') ?? 5;
      for (let i = 0; i < batchSize; i += 1) {
        const job = await this.sweepService.claimNextJob();
        if (!job) break;

        this.logger.log(
          `[SweepWorkerService] Claimed job for wallet ${job.walletAddress} (Attempt ${
            job.attempts + 1
          }/${job.maxAttempts})`,
        );
        DailyLogger.log(`[Sweep] Worker claimed job: wallet=${job.walletAddress}, attempt=${job.attempts + 1}/${job.maxAttempts}`, 'SweepWorkerService');
        await this.sweepService.processJob(job);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (err) {
      this.logger.error(
        `[SweepWorkerService] Sweep worker error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      DailyLogger.error(`[Sweep] Worker batch error: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined, 'SweepWorkerService');
    } finally {
      this.processing = false;
    }
  }
}

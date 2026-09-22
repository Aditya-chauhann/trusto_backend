import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SweepQueueService } from './sweep-queue.service';
import {
  SweepJob,
  SweepJobDocument,
  SweepJobStatus,
} from './schemas/sweep-job.schema';

@Injectable()
export class SweepRetryService {
  private readonly logger = new Logger(SweepRetryService.name);

  constructor(
    @InjectModel(SweepJob.name)
    private readonly sweepJobModel: Model<SweepJobDocument>,
    private readonly sweepQueue: SweepQueueService,
    private readonly config: ConfigService,
  ) {}

  /** Every 15 minutes: unlock stale in-progress jobs and re-queue retriable failures. */
  @Cron('0 */15 * * * *')
  async retryFailedAndStaleJobs(): Promise<void> {
    if (!(await this.sweepQueue.isEnabled())) return;

    const lockTtlMs = this.config.get<number>('sweep.jobLockTtlMs') ?? 600_000;
    const staleBefore = new Date(Date.now() - lockTtlMs);

    const staleInProgress = await this.sweepJobModel.updateMany(
      {
        status: { $in: [SweepJobStatus.FundingGas, SweepJobStatus.Sweeping] },
        lockedAt: { $lt: staleBefore },
      },
      {
        $set: {
          status: SweepJobStatus.Pending,
          lockedAt: null,
          error: 'Stale in-progress job reset for retry',
        },
      },
    );

    const retriableFailed = await this.sweepJobModel.updateMany(
      {
        status: SweepJobStatus.Failed,
        $expr: { $lt: ['$attempts', '$maxAttempts'] },
        lockedAt: null,
      },
      {
        $set: {
          status: SweepJobStatus.Pending,
          error: null,
        },
      },
    );

    if (staleInProgress.modifiedCount > 0 || retriableFailed.modifiedCount > 0) {
      this.logger.log(
        `Sweep retry cron: reset ${staleInProgress.modifiedCount} stale, re-queued ${retriableFailed.modifiedCount} failed`,
      );
    }
  }
}

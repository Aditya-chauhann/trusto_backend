import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SweepJob,
  SweepJobDocument,
  SweepJobStatus,
} from './schemas/sweep-job.schema';

import { PricingService } from '../pricing/pricing.service';

@Injectable()
export class SweepQueueService {
  private readonly logger = new Logger(SweepQueueService.name);

  constructor(
    @InjectModel(SweepJob.name)
    private readonly sweepJobModel: Model<SweepJobDocument>,
    private readonly config: ConfigService,
    private readonly pricingService: PricingService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const dynamicEnabled = await this.pricingService.isSweepEnabled().catch(() => null);
    const enabled = dynamicEnabled !== null ? dynamicEnabled : this.config.get<boolean>('sweep.enabled');
    if (!enabled) return false;
    const usdtDestination = (
      this.config.get<string>('sweep.usdtDestinationAddress') ??
      this.config.get<string>('sweep.adminWalletAddress')
    )?.trim();
    const gasKey = (
      this.config.get<string>('sweep.gasFeePrivateKey') ??
      this.config.get<string>('sweep.adminWalletPrivateKey')
    )?.trim();
    return Boolean(usdtDestination && gasKey);
  }

  async enqueue(
    walletAddress: string,
    triggerDepositId?: Types.ObjectId,
  ): Promise<void> {
    const isReady = await this.isEnabled();
    if (!isReady) {
      this.logger.debug('Sweep disabled or admin wallet not configured; skipping enqueue');
      return;
    }

    const address = walletAddress.trim();
    const existing = await this.sweepJobModel.findOne({
      walletAddress: address,
      $or: [
        { status: { $in: [SweepJobStatus.Pending, SweepJobStatus.FundingGas, SweepJobStatus.Sweeping] } },
        {
          status: SweepJobStatus.Failed,
          $expr: { $lt: ['$attempts', '$maxAttempts'] },
        },
      ],
    });

    if (existing) {
      this.logger.debug(
        `Active sweep job already exists for ${address} (${existing.status})`,
      );
      return;
    }

    const maxAttempts = this.config.get<number>('sweep.maxAttempts') ?? 5;
    const delayMinutes = await this.pricingService.getSweepDelayMinutes().catch(() => 0);
    const scheduledAt = delayMinutes > 0 ? new Date(Date.now() + delayMinutes * 60 * 1000) : null;

    try {
      await this.sweepJobModel.create({
        walletAddress: address,
        triggerDepositId: triggerDepositId ?? null,
        status: SweepJobStatus.Pending,
        attempts: 0,
        maxAttempts,
        scheduledAt,
      });
      this.logger.log(
        `Enqueued sweep job for wallet ${address} (delay: ${delayMinutes}m, scheduledAt: ${
          scheduledAt ? scheduledAt.toISOString() : 'immediate'
        })`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('duplicate key')) {
        this.logger.debug(`Sweep job deduped for ${address}`);
        return;
      }
      throw err;
    }
  }

  async listForAdmin(limit = 100): Promise<SweepJobDocument[]> {
    return this.sweepJobModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }
}

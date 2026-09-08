import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WalletsService } from '../wallets/wallets.service';
import { TronService } from './tron.service';
import {
  SweepJob,
  SweepJobDocument,
  SweepJobStatus,
} from './schemas/sweep-job.schema';
import { DailyLogger } from '../../common/daily-logger';

@Injectable()
export class SweepService {
  private readonly logger = new Logger(SweepService.name);

  constructor(
    @InjectModel(SweepJob.name)
    private readonly sweepJobModel: Model<SweepJobDocument>,
    private readonly walletsService: WalletsService,
    private readonly tronService: TronService,
    private readonly config: ConfigService,
  ) { }

  async claimNextJob(): Promise<SweepJobDocument | null> {
    // TODO: create jobs for all wallets after 10 minutes
    const lockTtlMs = this.config.get<number>('sweep.jobLockTtlMs') ?? 600_000;
    const staleBefore = new Date(Date.now() - lockTtlMs);

    return this.sweepJobModel
      .findOneAndUpdate(
        {
          status: { $in: [SweepJobStatus.Pending, SweepJobStatus.Failed] },
          $or: [
            { lockedAt: null },
            { lockedAt: { $lt: staleBefore } },
          ],
        },
        {
          $set: {
            lockedAt: new Date(),
            status: SweepJobStatus.Pending,
          },
        },
        { sort: { createdAt: 1 }, new: true },
      )
      .exec();
  }

  async processJob(job: SweepJobDocument): Promise<void> {
    const usdtDestinationAddress = (
      this.config.get<string>('sweep.usdtDestinationAddress') ??
      this.config.get<string>('sweep.adminWalletAddress')
    )?.trim();
    const gasFeePrivateKey = (
      this.config.get<string>('sweep.gasFeePrivateKey') ??
      this.config.get<string>('sweep.adminWalletPrivateKey')
    )?.trim();
    if (!usdtDestinationAddress || !gasFeePrivateKey) {
      this.logger.error(
        `[SweepService] Cannot process job for ${job.walletAddress}: Missing usdtDestinationAddress or gasFeePrivateKey`,
      );
      DailyLogger.error(`[Sweep] Cannot process job for wallet=${job.walletAddress}: missing config (destination or gas key)`, undefined, 'SweepService');
      await this.failJob(job, 'Sweep configuration missing destination address or gas fee private key');
      return;
    }

    const minUsdt = this.config.get<number>('sweep.minUsdt') ?? 1;
    const trxMinBalance = this.config.get<number>('sweep.trxMinBalance') ?? 5;
    const trxFundAmount = this.config.get<number>('sweep.trxFundAmount') ?? 20;

    this.logger.log(`[SweepService] Starting sweep processing for wallet ${job.walletAddress}...`);
    DailyLogger.log(`[Sweep] Starting sweep job: wallet=${job.walletAddress}`, 'SweepService');

    try {
      const wallet = await this.walletsService.findByAddress(job.walletAddress);
      if (!wallet) {
        this.logger.error(`[SweepService] Wallet not found in DB for address ${job.walletAddress}`);
        await this.failJob(job, `Wallet not found for address ${job.walletAddress}`);
        return;
      }

      job.walletId = wallet._id as Types.ObjectId;
      await job.save();

      const usdtBalance = await this.tronService.getUsdtBalance(job.walletAddress);
      job.usdtAmount = usdtBalance;
      await job.save();

      this.logger.log(
        `[SweepService] Wallet ${job.walletAddress} balance: ${usdtBalance} USDT (Threshold: ${minUsdt} USDT)`,
      );

      if (usdtBalance < minUsdt) {
        await this.completeJob(job, null, 0);
        this.logger.log(
          `[SweepService] Sweep SKIPPED for ${job.walletAddress}: balance ${usdtBalance} < min ${minUsdt}`,
        );
        return;
      }

      const userPrivateKey = await this.walletsService.reconstructPrivateKey(
        wallet._id as Types.ObjectId,
      );

      const trxBalance = await this.tronService.getTrxBalance(job.walletAddress);
      this.logger.log(
        `[SweepService] Wallet ${job.walletAddress} TRX balance: ${trxBalance} TRX (Min TRX needed: ${trxMinBalance})`,
      );

      if (trxBalance < trxMinBalance) {
        this.logger.log(
          `[SweepService] Funding TRX gas to ${job.walletAddress}: sending ${trxFundAmount} TRX...`,
        );
        job.status = SweepJobStatus.FundingGas;
        await job.save();

        const fundTxHash = await this.tronService.sendTrx(
          gasFeePrivateKey,
          job.walletAddress,
          trxFundAmount,
        );
        job.gasFundingTxHash = fundTxHash;
        try {
          job.gasDispenserAddress = this.tronService.getAddressFromPrivateKey(gasFeePrivateKey);
        } catch {
          job.gasDispenserAddress = this.config.get<string>('sweep.gasFeeWalletAddress') ?? 'TPzEBy29h7hECMymPNRx9mGSqehf6THS2k';
        }
        await job.save();

        this.logger.log(
          `[SweepService] TRX gas sent (tx=${fundTxHash}). Waiting for block confirmation...`,
        );
        await this.tronService.waitForConfirmation(fundTxHash);
        this.logger.log(`[SweepService] TRX gas funding confirmed for ${job.walletAddress}.`);
      }

      job.status = SweepJobStatus.Sweeping;
      job.usdtDestinationAddress = usdtDestinationAddress;
      await job.save();

      this.logger.log(
        `[SweepService] Sweeping ${usdtBalance} USDT from ${job.walletAddress} -> ${usdtDestinationAddress}...`,
      );
      const sweepTxHash = await this.tronService.sendUsdt(
        userPrivateKey,
        usdtDestinationAddress,
        usdtBalance,
      );
      job.sweepTxHash = sweepTxHash;
      await job.save();

      this.logger.log(
        `[SweepService] USDT sweep tx sent (tx=${sweepTxHash}). Waiting for block confirmation...`,
      );
      await this.tronService.waitForConfirmation(sweepTxHash);
      DailyLogger.log(`[Sweep] USDT sweep confirmed on-chain: wallet=${job.walletAddress}, amount=${usdtBalance} USDT, txHash=${sweepTxHash}`, 'SweepService');
      await this.completeJob(job, sweepTxHash, usdtBalance);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[SweepService] Sweep FAILED for ${job.walletAddress}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      DailyLogger.error(`[Sweep] Sweep FAILED: wallet=${job.walletAddress}, error=${message}`, err instanceof Error ? err.stack : undefined, 'SweepService');
      await this.failJob(job, message);
    }
  }

  private async completeJob(
    job: SweepJobDocument,
    sweepTxHash: string | null,
    sweptAmount: number,
  ): Promise<void> {
    job.status = SweepJobStatus.Completed;
    job.sweptAmount = sweptAmount;
    if (sweepTxHash) {
      job.sweepTxHash = sweepTxHash;
    }
    job.error = null;
    job.lockedAt = null;
    job.completedAt = new Date();
    await job.save();
    this.logger.log(
      `Sweep completed for ${job.walletAddress}: ${sweptAmount} USDT tx=${sweepTxHash ?? 'n/a'}`,
    );
    DailyLogger.log(`[Sweep] Job completed: wallet=${job.walletAddress}, sweptAmount=${sweptAmount} USDT, txHash=${sweepTxHash ?? 'n/a'}`, 'SweepService');
  }

  private async failJob(job: SweepJobDocument, error: string): Promise<void> {
    job.attempts += 1;
    job.error = error;
    job.lockedAt = null;
    job.status = SweepJobStatus.Failed;
    await job.save();
  }
}

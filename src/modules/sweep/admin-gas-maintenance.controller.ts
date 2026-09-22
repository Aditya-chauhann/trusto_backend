import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { GasAlertService } from './gas-alert.service';
import { PricingService } from '../pricing/pricing.service';
import { SweepService } from './sweep.service';
import { SweepWorkerService } from './sweep-worker.service';

@Controller('admin/gas-maintenance')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Wallets)
export class AdminGasMaintenanceController {
  constructor(
    private readonly gasAlertService: GasAlertService,
    private readonly pricingService: PricingService,
    private readonly sweepService: SweepService,
    private readonly sweepWorker: SweepWorkerService,
  ) {}

  @Get()
  async getGasMaintenance() {
    const status = await this.gasAlertService.checkAndNotifyGasBalance(false);
    const sweepEnabled = await this.pricingService.isSweepEnabled();
    const sweepDelayMinutes = await this.pricingService.getSweepDelayMinutes();

    return {
      ...status,
      sweepEnabled,
      sweepDelayMinutes,
    };
  }

  @Post('check')
  async triggerGasCheck() {
    const status = await this.gasAlertService.checkAndNotifyGasBalance(false);
    const sweepEnabled = await this.pricingService.isSweepEnabled();
    const sweepDelayMinutes = await this.pricingService.getSweepDelayMinutes();

    return {
      ...status,
      sweepEnabled,
      sweepDelayMinutes,
      message: 'Gas balance checked successfully',
    };
  }

  @Post('test-alert')
  async triggerTestAlert() {
    const status = await this.gasAlertService.checkAndNotifyGasBalance(true);
    const sweepEnabled = await this.pricingService.isSweepEnabled();
    const sweepDelayMinutes = await this.pricingService.getSweepDelayMinutes();

    return {
      ...status,
      sweepEnabled,
      sweepDelayMinutes,
      message: 'Test alert sent to Telegram Security Bot',
    };
  }

  @Post('sweep-now')
  async triggerSweepNow() {
    const sweepEnabled = await this.pricingService.isSweepEnabled();
    if (!sweepEnabled) {
      throw new BadRequestException(
        'Auto Sweep Engine is currently disabled. Please enable it before running a sweep.',
      );
    }
    const result = await this.sweepService.sweepAllNow();
    void this.sweepWorker.processPendingJobs();

    return {
      success: true,
      modifiedCount: result.count,
      message:
        result.count > 0
          ? `Immediate sweep triggered! Fast-tracked ${result.count} pending deposit(s) for consolidation.`
          : 'Immediate sweep engine check started for all pending deposits.',
    };
  }

  @Post('sweep-wallet')
  async triggerSweepWallet(@Body('walletAddress') walletAddress: string) {
    if (!walletAddress || typeof walletAddress !== 'string' || walletAddress.trim().length === 0) {
      throw new BadRequestException('walletAddress is required');
    }
    const sweepEnabled = await this.pricingService.isSweepEnabled();
    if (!sweepEnabled) {
      throw new BadRequestException(
        'Auto Sweep Engine is currently disabled in Settings. Enable sweep first before sweeping.',
      );
    }
    const job = await this.sweepService.sweepWalletNow(walletAddress.trim());
    if (job) {
      void this.sweepService.processJob(job);
    }
    return {
      success: true,
      message: `Instant sweep initiated for wallet ${walletAddress.trim()}. On-chain consolidation in progress.`,
    };
  }
}

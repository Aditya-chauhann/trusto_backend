import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { GasAlertService } from './gas-alert.service';
import { PricingService } from '../pricing/pricing.service';

@Controller('admin/gas-maintenance')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Wallets)
export class AdminGasMaintenanceController {
  constructor(
    private readonly gasAlertService: GasAlertService,
    private readonly pricingService: PricingService,
  ) {}

  @Get()
  async getGasMaintenance() {
    const status = await this.gasAlertService.checkAndNotifyGasBalance(false);
    const sweepEnabled = await this.pricingService.isSweepEnabled();

    return {
      ...status,
      sweepEnabled,
    };
  }

  @Post('check')
  async triggerGasCheck() {
    const status = await this.gasAlertService.checkAndNotifyGasBalance(false);
    const sweepEnabled = await this.pricingService.isSweepEnabled();

    return {
      ...status,
      sweepEnabled,
      message: 'Gas balance checked successfully',
    };
  }

  @Post('test-alert')
  async triggerTestAlert() {
    const status = await this.gasAlertService.checkAndNotifyGasBalance(true);
    const sweepEnabled = await this.pricingService.isSweepEnabled();

    return {
      ...status,
      sweepEnabled,
      message: 'Test alert sent to Telegram Security Bot',
    };
  }
}

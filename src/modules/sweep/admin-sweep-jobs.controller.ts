import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { SweepQueueService } from './sweep-queue.service';

@Controller('admin/sweep-jobs')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Deposits)
export class AdminSweepJobsController {
  constructor(private readonly sweepQueue: SweepQueueService) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 100;
    const safeLimit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
    const jobs = await this.sweepQueue.listForAdmin(safeLimit);
    return jobs.map((job) => ({
      id: job._id.toString(),
      walletAddress: job.walletAddress,
      walletId: job.walletId?.toString() ?? null,
      triggerDepositId: job.triggerDepositId?.toString() ?? null,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      usdtAmount: job.usdtAmount,
      sweptAmount: job.sweptAmount,
      gasFundingTxHash: job.gasFundingTxHash,
      gasDispenserAddress: job.gasDispenserAddress,
      sweepTxHash: job.sweepTxHash,
      usdtDestinationAddress: job.usdtDestinationAddress,
      error: job.error,
      scheduledAt: job.scheduledAt?.toISOString() ?? null,
      lockedAt: job.lockedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      createdAt: (job as unknown as { createdAt?: Date }).createdAt?.toISOString() ?? null,
      updatedAt: (job as unknown as { updatedAt?: Date }).updatedAt?.toISOString() ?? null,
    }));
  }
}

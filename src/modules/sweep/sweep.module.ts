import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletsModule } from '../wallets/wallets.module';
import { SweepJob, SweepJobSchema } from './schemas/sweep-job.schema';
import { TronService } from './tron.service';
import { SweepQueueService } from './sweep-queue.service';
import { SweepService } from './sweep.service';
import { SweepWorkerService } from './sweep-worker.service';
import { SweepRetryService } from './sweep-retry.service';
import { AdminSweepJobsController } from './admin-sweep-jobs.controller';

import { PricingModule } from '../pricing/pricing.module';
import { GasAlertService } from './gas-alert.service';
import { AdminGasMaintenanceController } from './admin-gas-maintenance.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SweepJob.name, schema: SweepJobSchema }]),
    WalletsModule,
    PricingModule,
  ],
  controllers: [AdminSweepJobsController, AdminGasMaintenanceController],
  providers: [
    TronService,
    SweepQueueService,
    SweepService,
    SweepWorkerService,
    SweepRetryService,
    GasAlertService,
  ],
  exports: [SweepQueueService, GasAlertService, TronService],
})
export class SweepModule {}

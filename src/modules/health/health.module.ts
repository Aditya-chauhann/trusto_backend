import { Module } from '@nestjs/common';
import { SystemControlsModule } from '../system-controls/system-controls.module';
import { HealthController } from './health.controller';

@Module({
  imports: [SystemControlsModule],
  controllers: [HealthController],
})
export class HealthModule {}

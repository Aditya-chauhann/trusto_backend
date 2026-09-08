import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IpAttempt, IpAttemptSchema } from './schemas/ip-attempt.schema';
import { BlockedIp, BlockedIpSchema } from './schemas/blocked-ip.schema';
import { IpBlockService } from './ip-block.service';
import { IpBlockGuard } from './ip-block.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IpAttempt.name, schema: IpAttemptSchema },
      { name: BlockedIp.name, schema: BlockedIpSchema },
    ]),
  ],
  providers: [IpBlockService, IpBlockGuard],
  exports: [IpBlockService, IpBlockGuard],
})
export class IpBlockModule {}

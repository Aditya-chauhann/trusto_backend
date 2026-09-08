import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PayoutBridgeService } from './payout-bridge.service';
import { PayoutBridgeSignatureGuard } from './payout-bridge-signature.guard';

@Module({
  imports: [ConfigModule],
  providers: [PayoutBridgeService, PayoutBridgeSignatureGuard],
  exports: [PayoutBridgeService, PayoutBridgeSignatureGuard],
})
export class PayoutBridgeModule {}

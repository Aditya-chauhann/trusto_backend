import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { PayoutBridgeSignatureGuard } from '../payout-bridge/payout-bridge-signature.guard';
import { PayoutPaidCallbackDto } from '../payout-bridge/dto/payout-paid-callback.dto';
import { PayoutMatchedCallbackDto } from '../payout-bridge/dto/payout-matched-callback.dto';

// Inbound: payout-bridge -> TronPay. Signature-verified (HMAC over raw body).
@Controller('payout-bridge')
export class PayoutBridgeCallbackController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @UseGuards(PayoutBridgeSignatureGuard)
  @Post('callback')
  async onPaid(@Body() dto: PayoutPaidCallbackDto) {
    const result = await this.withdrawals.markPaidFromProof(dto);
    return { ok: true, status: result.status };
  }

  // A smart reservation was matched to a payer — create the "awaiting payment"
  // row the user can decline within 5 minutes.
  @UseGuards(PayoutBridgeSignatureGuard)
  @Post('matched')
  async onMatched(@Body() dto: PayoutMatchedCallbackDto) {
    await this.withdrawals.handleSmartMatched(dto);
    return { ok: true };
  }

  // A smart reservation was unmatched (sender declined) — remove the awaiting payment row.
  @UseGuards(PayoutBridgeSignatureGuard)
  @Post('unmatched')
  async onUnmatched(@Body() dto: { referenceId: string }) {
    await this.withdrawals.handleSmartUnmatched(dto);
    return { ok: true };
  }
}

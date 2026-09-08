import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DailyLogger } from '../../common/daily-logger';

export interface RegisterPayoutRequestInput {
  // The withdrawal id — the bridge echoes this back on its callback.
  referenceId: string;
  // INR amount the user should receive (what an LP must pay to the UPI). For a
  // smart request this is the CEILING (any offer <= this may match).
  amount: number;
  upiId: string;
  accountHolderName?: string;
  // Smart auto-liquidation: match any offer at or below `amount` (no floor).
  smart?: boolean;
}

export interface CancelPayoutRequestResult {
  cancelled: boolean;
  status: string | null;
}

/**
 * Outbound client: TronPay -> payout-bridge. Registers a payout request so the
 * bridge announces it in Telegram and starts watching for a matching screenshot.
 * Fire-and-forget from the caller's perspective: a bridge outage must never roll
 * back the user's withdrawal.
 */
@Injectable()
export class PayoutBridgeService {
  private readonly logger = new Logger(PayoutBridgeService.name);

  constructor(private readonly config: ConfigService) {}

  async registerPayoutRequest(
    input: RegisterPayoutRequestInput,
  ): Promise<void> {
    const baseUrl = this.config.get<string>('payoutBridge.baseUrl');
    if (!baseUrl) {
      this.logger.warn('PAYOUT_BRIDGE_URL not set — skipping registration');
      return;
    }
    const apiKey = this.config.get<string>('payoutBridge.apiKey') ?? '';

    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/payout-requests`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(input),
      });
      if (res.status === 409) {
        // Already registered — idempotent (e.g. the reconciliation sweep). Fine.
        this.logger.debug(
          `payout-bridge already has ref ${input.referenceId}`,
        );
      } else if (!res.ok) {
        this.logger.error(
          `payout-bridge registration failed: ${res.status} for ref ${input.referenceId}`,
        );
        DailyLogger.error(`payout-bridge registration failed: ${res.status} for ref ${input.referenceId}`, undefined, 'PayoutBridgeService');
      } else {
        DailyLogger.log(`Payout request registered on bridge: ref=${input.referenceId}, amount=${input.amount}, upi=${input.upiId}`, 'PayoutBridgeService');
      }
    } catch (err) {
      // TODO: persist + retry so a transient outage doesn't drop the request.
      this.logger.error('payout-bridge registration threw', err as Error);
      DailyLogger.error('payout-bridge registration threw', (err as Error).stack, 'PayoutBridgeService');
    }
  }

  // Forward a raised dispute (bank-statement PDF + details) to the bridge, which
  // uploads the PDF to Cloudinary and posts it into the payout's Telegram group.
  // Returns the hosted PDF URL (null on failure — the dispute is still recorded).
  async sendDispute(input: {
    referenceId: string;
    upiId: string;
    amount: number;
    issue: string;
    disputeId?: string;
    file: { buffer: Buffer; originalname: string };
  }): Promise<{ pdfUrl: string | null }> {
    const baseUrl = this.config.get<string>('payoutBridge.baseUrl');
    if (!baseUrl) {
      this.logger.warn('PAYOUT_BRIDGE_URL not set — skipping dispute forward');
      return { pdfUrl: null };
    }
    const apiKey = this.config.get<string>('payoutBridge.apiKey') ?? '';
    try {
      const fd = new FormData();
      fd.append('referenceId', input.referenceId);
      fd.append('upiId', input.upiId);
      fd.append('amount', String(input.amount));
      fd.append('issue', input.issue);
      if (input.disputeId) fd.append('disputeId', input.disputeId);
      fd.append(
        'bankStatement',
        new Blob([new Uint8Array(input.file.buffer)], {
          type: 'application/pdf',
        }),
        input.file.originalname || `dispute-${input.referenceId}.pdf`,
      );
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/disputes`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: fd,
      });
      if (!res.ok) {
        this.logger.error(
          `payout-bridge dispute forward failed: ${res.status} for ref ${input.referenceId}`,
        );
        DailyLogger.error(`payout-bridge dispute forward failed: ${res.status} for ref ${input.referenceId}`, undefined, 'PayoutBridgeService');
        return { pdfUrl: null };
      }
      const data = (await res.json()) as { pdfUrl: string | null };
      DailyLogger.log(`Dispute forwarded to bridge successfully: ref=${input.referenceId}, pdfUrl=${data.pdfUrl}`, 'PayoutBridgeService');
      return data;
    } catch (err) {
      this.logger.error('payout-bridge dispute forward threw', err as Error);
      DailyLogger.error('payout-bridge dispute forward threw', (err as Error).stack, 'PayoutBridgeService');
      return { pdfUrl: null };
    }
  }

  // The receiver (user) declined a smart match within their 5-min window. Tells
  // the bridge to remove the announcement, drop the payer, and cancel the request
  // (no re-offer). Best-effort; returns whether the bridge cancelled it.
  async userDeclinePayoutRequest(
    referenceId: string,
  ): Promise<{ cancelled: boolean }> {
    const baseUrl = this.config.get<string>('payoutBridge.baseUrl');
    if (!baseUrl) return { cancelled: false };
    const apiKey = this.config.get<string>('payoutBridge.apiKey') ?? '';
    try {
      const res = await fetch(
        `${baseUrl.replace(/\/$/, '')}/payout-requests/${encodeURIComponent(
          referenceId,
        )}/user-decline`,
        { method: 'POST', headers: { 'x-api-key': apiKey } },
      );
      if (!res.ok) {
        this.logger.error(
          `payout-bridge user-decline failed: ${res.status} for ref ${referenceId}`,
        );
        DailyLogger.error(`payout-bridge user-decline failed: ${res.status} for ref ${referenceId}`, undefined, 'PayoutBridgeService');
        return { cancelled: false };
      }
      const data = (await res.json()) as { cancelled: boolean };
      DailyLogger.log(`User declined payout match on bridge: ref=${referenceId}, cancelled=${data.cancelled}`, 'PayoutBridgeService');
      return data;
    } catch (err) {
      this.logger.error('payout-bridge user-decline threw', err as Error);
      DailyLogger.error('payout-bridge user-decline threw', (err as Error).stack, 'PayoutBridgeService');
      return { cancelled: false };
    }
  }

  // Cancel a not-yet-matched request (used when a smart user turns Smart off, or
  // when re-arming for a larger balance). Returns whether the bridge actually
  // cancelled it (only `held` requests cancel; `announced` ones are left to
  // settle). On any error, reports not-cancelled so the caller stays safe.
  async cancelPayoutRequest(
    referenceId: string,
  ): Promise<CancelPayoutRequestResult> {
    const baseUrl = this.config.get<string>('payoutBridge.baseUrl');
    if (!baseUrl) {
      this.logger.warn('PAYOUT_BRIDGE_URL not set — skipping cancellation');
      return { cancelled: false, status: null };
    }
    const apiKey = this.config.get<string>('payoutBridge.apiKey') ?? '';

    try {
      const res = await fetch(
        `${baseUrl.replace(/\/$/, '')}/payout-requests/${encodeURIComponent(
          referenceId,
        )}`,
        {
          method: 'DELETE',
          headers: { 'x-api-key': apiKey },
        },
      );
      if (!res.ok) {
        this.logger.error(
          `payout-bridge cancellation failed: ${res.status} for ref ${referenceId}`,
        );
        DailyLogger.error(`payout-bridge cancellation failed: ${res.status} for ref ${referenceId}`, undefined, 'PayoutBridgeService');
        return { cancelled: false, status: null };
      }
      const data = (await res.json()) as CancelPayoutRequestResult;
      DailyLogger.log(`Payout request cancelled on bridge: ref=${referenceId}, cancelled=${data.cancelled}, status=${data.status}`, 'PayoutBridgeService');
      return data;
    } catch (err) {
      this.logger.error('payout-bridge cancellation threw', err as Error);
      DailyLogger.error('payout-bridge cancellation threw', (err as Error).stack, 'PayoutBridgeService');
      return { cancelled: false, status: null };
    }
  }
}

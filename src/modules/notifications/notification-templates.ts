import {
  DepositReceivedPayload,
  NotificationEvent,
  NotificationPayloadMap,
  SmartPayoutPaidPayload,
  TicketRaisedPayload,
  TicketResolvedPayload,
  WithdrawalApprovedPayload,
  WithdrawalRejectedPayload,
  WithdrawalRequestedPayload,
} from './notification-events';

export interface RenderedMessage {
  subject: string;
  emailText: string;
  emailHtml: string;
  smsText: string;
}

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function usdt(n: number): string {
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT`;
}

function wrapHtml(headline: string, bodyHtml: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px">${headline}</h2>
      ${bodyHtml}
      <p style="margin:20px 0 0;font-size:12px;color:#64748b">You're receiving this because email notifications are enabled on your TrustO account.</p>
    </div>
  `;
}

export function renderNotification<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadMap[E],
): RenderedMessage {
  switch (event) {
    case NotificationEvent.DepositReceived: {
      const p = payload as DepositReceivedPayload;
      const amt = `${p.amount} ${p.currency}`;
      return {
        subject: 'TrustO — Deposit received',
        emailText: `We've received your deposit of ${amt}. It is now reflected in your TrustO balance.`,
        emailHtml: wrapHtml(
          'Deposit received',
          `<p style="margin:0 0 12px">We've received your deposit of <strong>${amt}</strong>. It is now reflected in your TrustO balance.</p>`,
        ),
        smsText: `TrustO: Deposit of ${amt} received and credited to your account.`,
      };
    }
    case NotificationEvent.WithdrawalRequested: {
      const p = payload as WithdrawalRequestedPayload;
      return {
        subject: 'TrustO — Withdrawal request received',
        emailText: `Your withdrawal request for ${usdt(p.amount)} (${p.method}) has been received and is pending review.`,
        emailHtml: wrapHtml(
          'Withdrawal request received',
          `<p style="margin:0 0 12px">Your withdrawal of <strong>${usdt(p.amount)}</strong> via <strong>${p.method}</strong> is now <strong>pending review</strong>. We will notify you again once it is approved or rejected.</p>`,
        ),
        smsText: `TrustO: Withdrawal request for ${usdt(p.amount)} (${p.method}) received. We'll update you once reviewed.`,
      };
    }
    case NotificationEvent.WithdrawalApproved: {
      const p = payload as WithdrawalApprovedPayload;
      const ref =
        (p.method === 'bank' || p.method === 'upi') && p.utr
          ? ` UTR: ${p.utr}.`
          : p.method === 'crypto' && p.txHash
          ? ` Tx: ${p.txHash}.`
          : '';
      return {
        subject: 'TrustO — Withdrawal approved',
        emailText: `Your withdrawal of ${usdt(p.amount)} (${p.method}) has been approved and processed.${ref}`,
        emailHtml: wrapHtml(
          'Withdrawal approved',
          `<p style="margin:0 0 12px">Your withdrawal of <strong>${usdt(p.amount)}</strong> via <strong>${p.method}</strong> has been <strong>approved and processed</strong>.${ref ? `<br/><span style=\"color:#64748b;font-size:13px\">${ref.trim()}</span>` : ''}</p>`,
        ),
        smsText: `TrustO: Withdrawal of ${usdt(p.amount)} approved.${ref}`,
      };
    }
    case NotificationEvent.WithdrawalRejected: {
      const p = payload as WithdrawalRejectedPayload;
      return {
        subject: 'TrustO — Withdrawal rejected',
        emailText: `Your withdrawal request for ${usdt(p.amount)} was rejected. Reason: ${p.reason}`,
        emailHtml: wrapHtml(
          'Withdrawal rejected',
          `<p style="margin:0 0 8px">Your withdrawal request for <strong>${usdt(p.amount)}</strong> was <strong>rejected</strong>.</p><p style="margin:0;color:#64748b"><strong>Reason:</strong> ${p.reason}</p>`,
        ),
        smsText: `TrustO: Withdrawal of ${usdt(p.amount)} rejected. Reason: ${p.reason}`,
      };
    }
    case NotificationEvent.SmartPayoutPaid: {
      const p = payload as SmartPayoutPaidPayload;
      return {
        subject: 'TrustO — Auto-payout completed',
        emailText: `${inr(p.amountInr)} was paid to your UPI ${p.upiId} via Smart auto-liquidation.`,
        emailHtml: wrapHtml(
          'Auto-payout completed',
          `<p style="margin:0 0 12px"><strong>${inr(p.amountInr)}</strong> was paid to your UPI <strong>${p.upiId}</strong> via Smart auto-liquidation.</p>`,
        ),
        smsText: `TrustO: ${inr(p.amountInr)} paid to your UPI ${p.upiId} via Smart auto-liquidation.`,
      };
    }
    case NotificationEvent.TicketRaised: {
      const p = payload as TicketRaisedPayload;
      return {
        subject: 'TrustO — Support ticket received',
        emailText: `We've received your support ticket "${p.title}" (ID: ${p.ticketId}). Our team will get back to you shortly.`,
        emailHtml: wrapHtml(
          'Support ticket received',
          `<p style="margin:0 0 8px">We've received your support ticket:</p><p style="margin:0 0 12px;padding:12px;background:#f1f5f9;border-radius:6px"><strong>${p.title}</strong></p><p style="margin:0;color:#64748b">Ticket ID: ${p.ticketId}</p>`,
        ),
        smsText: `TrustO: Ticket "${p.title}" received. ID: ${p.ticketId}.`,
      };
    }
    case NotificationEvent.TicketResolved: {
      const p = payload as TicketResolvedPayload;
      return {
        subject: 'TrustO — Support ticket resolved',
        emailText: `Your support ticket "${p.title}" (ID: ${p.ticketId}) has been resolved.`,
        emailHtml: wrapHtml(
          'Ticket resolved',
          `<p style="margin:0 0 12px">Your support ticket has been <strong>resolved</strong>:</p><p style="margin:0 0 12px;padding:12px;background:#f1f5f9;border-radius:6px"><strong>${p.title}</strong></p><p style="margin:0;color:#64748b">Ticket ID: ${p.ticketId}</p>`,
        ),
        smsText: `TrustO: Ticket "${p.title}" has been resolved.`,
      };
    }
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unknown notification event: ${String(_exhaustive)}`);
    }
  }
  // Silence unused-payload warnings for cases that don't access payload (none here).
  void inr;
}

export enum NotificationEvent {
  DepositReceived = 'deposit_received',
  WithdrawalRequested = 'withdrawal_requested',
  WithdrawalApproved = 'withdrawal_approved',
  WithdrawalRejected = 'withdrawal_rejected',
  SmartPayoutPaid = 'smart_payout_paid',
  TicketRaised = 'ticket_raised',
  TicketResolved = 'ticket_resolved',
}

export interface DepositReceivedPayload {
  amount: number;
  currency: string;
}

export interface WithdrawalRequestedPayload {
  amount: number;
  method: 'bank' | 'upi' | 'crypto';
}

export interface WithdrawalApprovedPayload {
  amount: number;
  method: 'bank' | 'upi' | 'crypto';
  utr?: string | null;
  txHash?: string | null;
}

export interface WithdrawalRejectedPayload {
  amount: number;
  reason: string;
}

// Lightweight receipt for a Smart auto-liquidation fill (no approval/dispute).
export interface SmartPayoutPaidPayload {
  amountInr: number;
  upiId: string;
}

export interface TicketRaisedPayload {
  ticketId: string;
  title: string;
}

export interface TicketResolvedPayload {
  ticketId: string;
  title: string;
}

export type NotificationPayloadMap = {
  [NotificationEvent.DepositReceived]: DepositReceivedPayload;
  [NotificationEvent.WithdrawalRequested]: WithdrawalRequestedPayload;
  [NotificationEvent.WithdrawalApproved]: WithdrawalApprovedPayload;
  [NotificationEvent.WithdrawalRejected]: WithdrawalRejectedPayload;
  [NotificationEvent.SmartPayoutPaid]: SmartPayoutPaidPayload;
  [NotificationEvent.TicketRaised]: TicketRaisedPayload;
  [NotificationEvent.TicketResolved]: TicketResolvedPayload;
};

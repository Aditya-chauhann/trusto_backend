export const WITHDRAWAL_MIN_USDT = 50;
export const SMART_TOGGLE_MIN_USDT = 100;
export const WITHDRAWAL_FEE_RATE = 0;
export const USDT_INR_RATE = 118;

// After a UPI withdrawal is approved (marked paid), the user has this long to
// raise a "payment not received" dispute from the post-approval modal.
export const UPI_DISPUTE_WINDOW_MS = 10 * 60 * 1000;

// After a SMART auto-liquidation match is announced to a payer, the user has
// this long to decline the payment (unless the payer pays first).
export const SMART_DECLINE_WINDOW_MS = 5 * 60 * 1000;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

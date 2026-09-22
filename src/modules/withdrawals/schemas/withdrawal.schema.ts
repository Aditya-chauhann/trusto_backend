import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WithdrawalDocument = HydratedDocument<Withdrawal>;

export enum WithdrawalMethod {
  Bank = 'bank',
  Upi = 'upi',
  Crypto = 'crypto',
}

export enum WithdrawalStatus {
  Pending = 'pending',
  Processing = 'processing',
  Paid = 'paid',
  Failed = 'failed',
  // Smart auto-liquidation: the user's balance is armed/offered to the payout
  // pool and reserved (locked), waiting to be matched. Counts as locked like any
  // non-failed withdrawal. Becomes `paid` (for the matched amount) on a fill, or
  // `failed` (releasing the lock) if the user turns Smart off before a match.
  Reserved = 'reserved',
  // A raised dispute was approved by a super admin (a credit/debit was applied
  // to the user's balance). Reached from `pending` after a dispute is raised.
  Resolved = 'resolved',
  // Smart auto-liquidation: matched to a payer and awaiting their payment. The
  // user can decline within 5 min (until it becomes `paid`). Does NOT lock the
  // balance — nothing is deducted until the payer's screenshot lands.
  AwaitingPayment = 'awaiting_payment',
}

@Schema({ timestamps: true })
export class Withdrawal {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: WithdrawalMethod, index: true })
  method: WithdrawalMethod;

  @Prop({ required: true, type: Number })
  amount: number;

  @Prop({ required: true, type: Number })
  feeRate: number;

  @Prop({ required: true, type: Number })
  fxRate: number;

  @Prop({ required: true, type: Number })
  feeUsdt: number;

  @Prop({ required: true, type: Number })
  netUsdt: number;

  @Prop({ type: Number })
  grossInr?: number;

  @Prop({ type: Number })
  feeInr?: number;

  @Prop({ type: Number })
  netInr?: number;

  @Prop()
  bankName?: string;

  @Prop()
  accountNumber?: string;

  @Prop()
  ifscCode?: string;

  @Prop({ trim: true })
  accountHolderName?: string;

  @Prop()
  upiId?: string;

  @Prop()
  network?: string;

  @Prop()
  destinationAddress?: string;

  @Prop({
    required: true,
    enum: WithdrawalStatus,
    default: WithdrawalStatus.Pending,
    index: true,
  })
  status: WithdrawalStatus;

  @Prop()
  txHash?: string;

  @Prop({ trim: true, uppercase: true, index: true })
  utr?: string;

  @Prop()
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  processedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  processedAt: Date | null;

  @Prop({ type: String, default: null })
  decisionReason: string | null;

  // Set true once the user raises a "payment not received" dispute for this
  // (UPI) withdrawal, so the post-approval modal is not shown again.
  @Prop({ default: false })
  disputeRaised: boolean;

  // Set true when user attempts a second dispute after admin resolved/approved a past dispute
  @Prop({ default: false })
  secondDisputeAttempted: boolean;

  // 10-minute dispute window expiration timestamp set on payout completion
  @Prop({ type: Date, default: null })
  disputeWindowExpiresAt?: Date | null;

  // Cloudinary URL of the payment-proof screenshot, set when the payout-bridge
  // matches a screenshot to this (UPI) withdrawal. Stored on the user's record.
  @Prop({ type: String, default: null })
  paymentProofUrl: string | null;

  // Blurred copy reposted in the Telegram group (privacy).
  @Prop({ type: String, default: null })
  blurredProofUrl: string | null;

  // --- P2P settlement (set when the bridge confirms an over/under payment) ---
  // INR the matched buyer actually paid (may differ from netInr within tolerance).
  @Prop({ type: Number, default: null })
  paidInr: number | null;

  // netInr - paidInr (signed: + underpaid, - overpaid).
  @Prop({ type: Number, default: null })
  differenceInr: number | null;

  // USD applied to the user's balance for the difference, at the locked rate:
  // (netInr - paidInr) / fxRate. Positive = refund, negative = goes into the red.
  // Factored into available-balance via sumLockedFor (effective lock =
  // amount - balanceAdjustmentUsd).
  @Prop({ type: Number, default: 0 })
  balanceAdjustmentUsd: number;

  // --- Overpayment tag (payer sent MORE than announced, per the screenshot) ---
  // Positive extra INR the payer mistakenly sent (screenshotAmount - announced).
  // Informational flag set by the payout-bridge; does NOT affect balance math or
  // the settled amount above — the withdrawal still settles Paid on paidInr.
  @Prop({ type: Number, default: null, index: true })
  overpaidBy: number | null;

  // The amount the bridge OCR'd from the payer's screenshot when an overpayment
  // was detected (what the payer actually sent). null when no overpayment.
  @Prop({ type: Number, default: null })
  screenshotAmountInr: number | null;

  // Smart auto-liquidation record. When true, this withdrawal was created by a
  // Smart auto-liquidation FILL (an actual match). Smart withdrawals are created
  // only on a fill — never on arm/reserve — so they always represent real money.
  @Prop({ default: false, index: true })
  isSmart: boolean;

  // The bridge reference id of the reservation that produced this smart fill.
  // Used to make the fulfilment callback idempotent (duplicate callback returns
  // the already-created withdrawal instead of creating another).
  @Prop({ type: String, default: null, index: true })
  smartRef: string | null;

  // When this smart match was announced to a payer — the start of the user's
  // 5-minute decline window (row is created at this instant).
  @Prop({ type: Date, default: null })
  smartMatchedAt: Date | null;

  // User confirmed receipt during the post-payment dispute window.
  @Prop({ type: Date, default: null })
  userConfirmedAt: Date | null;

  // Set when the dispute window closes without a dispute being raised.
  @Prop({ type: Date, default: null })
  disputeWindowClosedAt: Date | null;
}

export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);

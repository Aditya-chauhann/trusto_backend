import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StaffTeam } from '../../staff/schemas/staff-role.schema';
import {
  TicketAssignmentStatus,
  TicketResolutionStatus,
} from '../../tickets/schemas/ticket.schema';

export type WithdrawalDisputeDocument = HydratedDocument<WithdrawalDispute>;

// Why the user raised the dispute from the post-approval modal.
export enum WithdrawalDisputeReason {
  NotReceived = 'not_received',
  WrongAmount = 'wrong_amount',
  Other = 'other',
}

// Super-admin outcome of a raised dispute.
export enum WithdrawalDisputeDecision {
  Approved = 'approved', // user was right — a balance credit/debit was applied
  Declined = 'declined', // dispute was false — transaction stands
}

// Disputes live in their own collection, separate from support tickets, but
// share the staff assignment/resolution lifecycle so they can be managed from
// the same ticket-management screen.
@Schema({ timestamps: true })
export class WithdrawalDispute {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Withdrawal',
    required: true,
    unique: true,
    index: true,
  })
  withdrawalId: Types.ObjectId;

  @Prop({
    required: true,
    type: String,
    enum: WithdrawalDisputeReason,
    default: WithdrawalDisputeReason.NotReceived,
    index: true,
  })
  reason: WithdrawalDisputeReason;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  description: string;

  // Snapshot of the disputed withdrawal so the dispute is self-contained.
  @Prop({ type: Number, default: null })
  amountUsdt: number | null;

  @Prop({ type: Number, default: null })
  netInr: number | null;

  @Prop({ type: String, default: null })
  upiId: string | null;

  @Prop({ type: String, default: null })
  utr: string | null;

  // The bank-statement PDF the user uploaded when raising the dispute (hosted on
  // Cloudinary via the payout-bridge; also posted into the Telegram group).
  @Prop({ type: String, default: null })
  bankStatementUrl: string | null;

  @Prop({ type: String, default: null })
  bankStatementName: string | null;

  @Prop({
    required: true,
    type: String,
    enum: StaffTeam,
    default: StaffTeam.Support,
    index: true,
  })
  team: StaffTeam;

  @Prop({
    required: true,
    type: String,
    enum: TicketAssignmentStatus,
    default: TicketAssignmentStatus.Unassigned,
    index: true,
  })
  assignmentStatus: TicketAssignmentStatus;

  @Prop({ type: Types.ObjectId, ref: 'StaffUser', default: null, index: true })
  assigneeId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  assignedAt: Date | null;

  @Prop({
    required: true,
    type: String,
    enum: TicketResolutionStatus,
    default: TicketResolutionStatus.Pending,
    index: true,
  })
  resolutionStatus: TicketResolutionStatus;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'StaffUser', default: null })
  resolvedBy: Types.ObjectId | null;

  @Prop({ type: String, default: null, trim: true })
  resolutionNotes: string | null;

  // Super-admin decision on the dispute (approved/declined), and the signed USDT
  // balance adjustment applied on approval (+ credit, - debit; 0 on decline).
  @Prop({ type: String, enum: WithdrawalDisputeDecision, default: null })
  resolutionDecision: WithdrawalDisputeDecision | null;

  @Prop({ type: Number, default: 0 })
  resolutionAdjustmentUsd: number;
}

export const WithdrawalDisputeSchema =
  SchemaFactory.createForClass(WithdrawalDispute);

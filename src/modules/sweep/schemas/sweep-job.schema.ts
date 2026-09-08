import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SweepJobDocument = HydratedDocument<SweepJob>;

export enum SweepJobStatus {
  Pending = 'pending',
  FundingGas = 'funding_gas',
  Sweeping = 'sweeping',
  Completed = 'completed',
  Failed = 'failed',
}

@Schema({ timestamps: true, collection: 'sweep_jobs' })
export class SweepJob {
  @Prop({ required: true, index: true })
  walletAddress: string;

  @Prop({ type: Types.ObjectId, ref: 'Wallet', default: null })
  walletId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Deposit', default: null })
  triggerDepositId: Types.ObjectId | null;

  @Prop({
    required: true,
    enum: SweepJobStatus,
    default: SweepJobStatus.Pending,
    index: true,
  })
  status: SweepJobStatus;

  @Prop({ required: true, default: 0 })
  attempts: number;

  @Prop({ required: true, default: 5 })
  maxAttempts: number;

  @Prop({ type: Number, default: null })
  usdtAmount: number | null;

  @Prop({ type: Number, default: null })
  sweptAmount: number | null;

  @Prop({ type: String, default: null })
  gasFundingTxHash: string | null;

  @Prop({ type: String, default: null })
  gasDispenserAddress: string | null;

  @Prop({ type: String, default: null })
  sweepTxHash: string | null;

  @Prop({ type: String, default: null })
  usdtDestinationAddress: string | null;

  @Prop({ type: String, default: null })
  error: string | null;

  @Prop({ type: Date, default: null })
  lockedAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;
}

export const SweepJobSchema = SchemaFactory.createForClass(SweepJob);

SweepJobSchema.index(
  { walletAddress: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['pending', 'funding_gas', 'sweeping'] },
    },
  },
);

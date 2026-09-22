import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DepositDocument = HydratedDocument<Deposit>;

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Deposit {
  @Prop({ required: true, unique: true, index: true })
  transactionId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  userId: Types.ObjectId | null;

  @Prop({ required: true, index: true })
  walletAddress: string;

  @Prop({ required: true, type: Number })
  amount: number;

  @Prop({ required: true })
  currency: string;

  @Prop({ required: true, type: Date })
  timestamp: Date;

  @Prop({ required: true, type: Object })
  rawPayload: Record<string, unknown>;

  @Prop({ type: String, default: null, index: true })
  sweepStatus: string | null;

  @Prop({ type: String, default: null })
  sweepTxHash: string | null;

  @Prop({ type: Date, default: null })
  sweptAt: Date | null;
}

export const DepositSchema = SchemaFactory.createForClass(Deposit);

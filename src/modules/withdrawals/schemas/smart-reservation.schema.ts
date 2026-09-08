import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SmartReservationDocument = HydratedDocument<SmartReservation>;

export enum SmartReservationStatus {
  Held = 'held',
  Matched = 'matched',
  Fulfilled = 'fulfilled',
  Cancelled = 'cancelled',
}

@Schema({ timestamps: true })
export class SmartReservation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  referenceId: string;

  @Prop({ required: true, lowercase: true, trim: true })
  upiId: string;

  @Prop({ type: String, default: null })
  accountHolderName?: string | null;

  @Prop({ required: true, type: Number })
  fxRate: number;

  @Prop({ required: true, type: Number })
  ceilingInr: number;

  @Prop({ required: true, type: Number })
  ceilingUsd: number;

  @Prop({
    required: true,
    enum: SmartReservationStatus,
    default: SmartReservationStatus.Held,
    index: true,
  })
  status: SmartReservationStatus;

  @Prop({ type: Types.ObjectId, ref: 'Withdrawal', default: null })
  matchedWithdrawalId: Types.ObjectId | null;
}

export const SmartReservationSchema =
  SchemaFactory.createForClass(SmartReservation);

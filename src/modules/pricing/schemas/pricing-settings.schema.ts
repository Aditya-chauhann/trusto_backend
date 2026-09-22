import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PricingSettingsDocument = HydratedDocument<PricingSettings>;

export const PRICING_SETTINGS_KEY = 'global';

@Schema({ timestamps: true })
export class PricingSettings {
  @Prop({ required: true, unique: true, index: true })
  key: string;

  @Prop({ required: true, type: Number, min: 0 })
  usdtPrice: number;

  @Prop({ required: true, type: Number, min: 0 })
  inrPrice: number;

  @Prop({ required: true, type: Number, min: 0, default: 82.5 })
  upiInrPrice: number;

  @Prop({ required: true, type: Number, min: 0, max: 1 })
  feePercent: number;

  @Prop({ required: true, type: Number, min: 0, max: 1, default: 0 })
  bankFee: number;

  @Prop({ required: true, type: Number, min: 0, max: 1, default: 0 })
  cryptoFee: number;

  @Prop({ required: true, type: Number, min: 0, default: 100 })
  smartToggleMinUsdt: number;

  @Prop({ type: Boolean, default: true })
  enableDeposits: boolean;

  @Prop({ type: Boolean, default: true })
  enableWithdrawals: boolean;

  @Prop({ type: Boolean, default: true })
  enableBankWithdrawal: boolean;

  @Prop({ type: Boolean, default: true })
  enableUpiWithdrawal: boolean;

  @Prop({ type: Boolean, default: true })
  enableSmartUpiWithdrawal: boolean;

  @Prop({ type: Boolean, default: true })
  enableCryptoWithdrawal: boolean;

  @Prop({ type: Boolean, default: false })
  enableSweep: boolean;

  @Prop({ type: Number, default: 0, min: 0 })
  sweepDelayMinutes: number;

  @Prop({ type: Types.ObjectId, default: null })
  updatedBy: Types.ObjectId | null;

  @Prop({ type: String, enum: ['user', 'staff'], default: null })
  updatedByType: 'user' | 'staff' | null;
}

export const PricingSettingsSchema =
  SchemaFactory.createForClass(PricingSettings);

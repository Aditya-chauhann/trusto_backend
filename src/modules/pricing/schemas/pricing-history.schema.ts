import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PricingHistoryDocument = HydratedDocument<PricingHistory>;

export type PricingField =
  | 'usdtPrice'
  | 'inrPrice'
  | 'upiInrPrice'
  | 'feePercent'
  | 'bankFee'
  | 'cryptoFee'
  | 'smartToggleMinUsdt'
  | 'enableDeposits'
  | 'enableWithdrawals'
  | 'enableBankWithdrawal'
  | 'enableUpiWithdrawal'
  | 'enableSmartUpiWithdrawal'
  | 'enableCryptoWithdrawal'
  | 'enableSweep'
  | 'sweepDelayMinutes';

export enum PricingHistoryScope {
  Global = 'global',
  User = 'user',
}

export enum PricingHistoryAction {
  Update = 'update',
  Clear = 'clear',
}

@Schema({ _id: false })
export class PricingChange {
  @Prop({ required: true, type: String })
  field: PricingField;

  @Prop({ type: Object, default: null })
  oldValue: number | boolean | null;

  @Prop({ type: Object, default: null })
  newValue: number | boolean | null;
}
const PricingChangeSchema = SchemaFactory.createForClass(PricingChange);

@Schema({ timestamps: { createdAt: 'at', updatedAt: false } })
export class PricingHistory {
  @Prop({
    required: true,
    enum: PricingHistoryScope,
    index: true,
  })
  scope: PricingHistoryScope;

  @Prop({
    required: true,
    enum: PricingHistoryAction,
  })
  action: PricingHistoryAction;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  userId: Types.ObjectId | null;

  @Prop({ type: [PricingChangeSchema], default: [] })
  changes: PricingChange[];

  @Prop({ type: Types.ObjectId, required: true })
  changedBy: Types.ObjectId;

  @Prop({ type: String, enum: ['user', 'staff'], required: true })
  changedByType: 'user' | 'staff';
}

export const PricingHistorySchema = SchemaFactory.createForClass(PricingHistory);

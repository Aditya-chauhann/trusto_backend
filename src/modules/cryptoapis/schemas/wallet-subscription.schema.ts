import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WalletSubscriptionDocument = HydratedDocument<WalletSubscription>;

export enum WalletSubscriptionStatus {
  Active = 'active',
  Failed = 'failed',
}

@Schema({ timestamps: true })
export class WalletSubscription {
  @Prop({ required: true, unique: true, index: true })
  address: string;

  @Prop({ required: true })
  subscriptionId: string;

  @Prop({
    required: true,
    default: 'address-tokens-transactions-confirmed',
  })
  eventType: string;

  @Prop({
    required: true,
    enum: WalletSubscriptionStatus,
    default: WalletSubscriptionStatus.Active,
    index: true,
  })
  status: WalletSubscriptionStatus;

  @Prop()
  lastError?: string;
}

export const WalletSubscriptionSchema =
  SchemaFactory.createForClass(WalletSubscription);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserPricingDocument = HydratedDocument<UserPricing>;

@Schema({ timestamps: true })
export class UserPricing {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ type: Number, min: 0, default: null })
  usdtPrice: number | null;

  @Prop({ type: Number, min: 0, default: null })
  inrPrice: number | null;

  @Prop({ type: Number, min: 0, default: null })
  upiInrPrice: number | null;

  @Prop({ type: Number, min: 0, max: 1, default: null })
  feePercent: number | null;

  @Prop({ type: Types.ObjectId, default: null })
  setBy: Types.ObjectId | null;

  @Prop({ type: String, enum: ['user', 'staff'], default: null })
  setByType: 'user' | 'staff' | null;
}

export const UserPricingSchema = SchemaFactory.createForClass(UserPricing);

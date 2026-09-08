import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserTagDocument = HydratedDocument<UserTag>;

export enum ThresholdPeriod {
  Day = 'day',
  Week = 'week',
  Month = 'month',
}

@Schema({ timestamps: true })
export class UserTag {
  @Prop({ required: true, unique: true, trim: true, index: true })
  name: string;

  @Prop({ required: true, unique: true, type: Number, min: 1 })
  rank: number;

  @Prop({ required: true, type: Number, min: 0 })
  thresholdAmount: number;

  @Prop({ required: true, enum: ThresholdPeriod })
  thresholdPeriod: ThresholdPeriod;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ type: String, trim: true, default: null })
  color: string | null;

  @Prop({ type: Number, min: 0, default: 0 })
  benefitInr: number;

  @Prop({ default: false })
  isDefault: boolean;
}

export const UserTagSchema = SchemaFactory.createForClass(UserTag);

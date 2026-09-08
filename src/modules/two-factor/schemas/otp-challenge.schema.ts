import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OtpChallengeDocument = HydratedDocument<OtpChallenge>;

export enum OtpChannel {
  Email = 'email',
  Phone = 'phone',
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class OtpChallenge {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: OtpChannel })
  channel: OtpChannel;

  @Prop({ required: true })
  contact: string;

  @Prop({ type: String, default: null })
  codeHash: string | null;

  @Prop({ required: true, type: Date, expires: 0 })
  expiresAt: Date;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: false })
  consumed: boolean;
}

export const OtpChallengeSchema = SchemaFactory.createForClass(OtpChallenge);

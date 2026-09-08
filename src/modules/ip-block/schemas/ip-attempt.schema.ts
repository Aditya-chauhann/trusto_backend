import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type IpAttemptDocument = HydratedDocument<IpAttempt>;

@Schema()
export class IpAttempt {
  @Prop({ required: true, index: true })
  ip: string;

  @Prop({ required: true })
  endpoint: string;

  @Prop({ type: Date, default: Date.now, index: true })
  createdAt: Date;
}

export const IpAttemptSchema = SchemaFactory.createForClass(IpAttempt);
IpAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

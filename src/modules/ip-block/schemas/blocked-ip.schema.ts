import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BlockedIpDocument = HydratedDocument<BlockedIp>;

@Schema({ timestamps: true })
export class BlockedIp {
  @Prop({ required: true, unique: true, index: true })
  ip: string;

  @Prop({ required: true, index: true })
  blockedUntil: Date;

  @Prop({ required: true })
  reason: string;
}

export const BlockedIpSchema = SchemaFactory.createForClass(BlockedIp);
// TTL index: automatically deletes the document when current date is past blockedUntil
BlockedIpSchema.index({ blockedUntil: 1 }, { expireAfterSeconds: 0 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserTagHistoryDocument = HydratedDocument<UserTagHistory>;

export type TagChangeSource = 'auto' | 'manual';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class UserTagHistory {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'UserTag', default: null })
  fromTag: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'UserTag', default: null })
  toTag: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: ['auto', 'manual'] })
  source: TagChangeSource;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  reason: string | null;
}

export const UserTagHistorySchema =
  SchemaFactory.createForClass(UserTagHistory);

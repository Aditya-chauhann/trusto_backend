import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletShard2Document = HydratedDocument<WalletShard2>;

@Schema({ timestamps: true, collection: 'wallet_shards_2' })
export class WalletShard2 {
  @Prop({ type: Types.ObjectId, required: true, unique: true, index: true })
  walletId: Types.ObjectId;

  @Prop({ required: true })
  walletAddress: string;

  @Prop({ required: true })
  encryptedShard: string;

  @Prop({ required: true })
  iv: string;

  @Prop({ required: true })
  authTag: string;
}

export const WalletShard2Schema = SchemaFactory.createForClass(WalletShard2);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletShard1Document = HydratedDocument<WalletShard1>;

@Schema({ timestamps: true, collection: 'wallet_shards_1' })
export class WalletShard1 {
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

export const WalletShard1Schema = SchemaFactory.createForClass(WalletShard1);

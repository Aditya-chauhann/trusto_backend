import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

export enum WalletStatus {
  Unused = 'unused',
  Assigned = 'assigned',
  Replaced = 'replaced',
}

@Schema({ timestamps: true })
export class Wallet {
  @Prop({ required: true, unique: true, index: true })
  address: string;

  @Prop({
    required: true,
    enum: WalletStatus,
    default: WalletStatus.Unused,
    index: true,
  })
  status: WalletStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignedTo: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  assignedAt: Date | null;

  @Prop({ type: Buffer, select: false })
  qrImage?: Buffer;

  @Prop({ default: 'image/png' })
  qrImageMimeType?: string;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);

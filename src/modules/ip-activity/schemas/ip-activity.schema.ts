import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type IpActivityDocument = IpActivity & Document;

@Schema({ timestamps: true })
export class IpActivity {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  userId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, required: false })
  email?: string;

  @Prop({ type: String, required: false })
  phone?: string;

  @Prop({ type: String, required: true })
  actionType: string; // 'login_success', 'login_failed', 'wrong_password', 'wrong_captcha', 'deposit', 'withdrawal', 'account_locked'

  @Prop({ type: String, required: true })
  ipAddress: string;

  @Prop({ type: MongooseSchema.Types.Map, of: String, required: false })
  details?: Record<string, string>;
}

export const IpActivitySchema = SchemaFactory.createForClass(IpActivity);

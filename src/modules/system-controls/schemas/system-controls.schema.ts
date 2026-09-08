import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SystemControlsDocument = HydratedDocument<SystemControls>;

export const SYSTEM_CONTROLS_KEY = 'global';

@Schema({ timestamps: true })
export class SystemControls {
  @Prop({ required: true, unique: true, index: true })
  key: string;

  @Prop({ required: true, default: true })
  depositsEnabled: boolean;

  @Prop({ required: true, default: true })
  withdrawalsEnabled: boolean;

  @Prop({ trim: true, default: '' })
  depositsDisabledReason: string;

  @Prop({ trim: true, default: '' })
  withdrawalsDisabledReason: string;

  /** When true the storefront shows the maintenance page instead of the app. */
  @Prop({ required: true, default: false })
  maintenanceMode: boolean;

  @Prop({ trim: true, default: '' })
  maintenanceMessage: string;

  /** Optional "back by" estimate surfaced on the maintenance page. */
  @Prop({ type: Date, default: null })
  maintenanceEta: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  updatedBy: Types.ObjectId | null;

  @Prop({ type: String, enum: ['user', 'staff'], default: null })
  updatedByType: 'user' | 'staff' | null;
}

export const SystemControlsSchema =
  SchemaFactory.createForClass(SystemControls);

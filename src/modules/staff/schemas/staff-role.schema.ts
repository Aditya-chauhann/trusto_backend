import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { isValidPermissionKey } from '../permissions.constants';

export type StaffRoleDocument = HydratedDocument<StaffRole>;

export enum StaffTeam {
  Support = 'support',
  Tech = 'tech',
}

@Schema({ timestamps: true })
export class StaffRole {
  @Prop({ required: true, trim: true, unique: true, index: true })
  name: string;

  @Prop({ trim: true, default: '' })
  description: string;

  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (keys: string[]) =>
        Array.isArray(keys) && keys.every((k) => isValidPermissionKey(k)),
      message: 'permissions contains an unknown permission key',
    },
  })
  permissions: string[];

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ type: String, enum: StaffTeam, default: null, index: true })
  team: StaffTeam | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;
}

export const StaffRoleSchema = SchemaFactory.createForClass(StaffRole);

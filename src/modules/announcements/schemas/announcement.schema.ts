import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AnnouncementDocument = HydratedDocument<Announcement>;

export enum AnnouncementTarget {
  All = 'all',
  Users = 'users',
  Staff = 'staff',
}

export enum AnnouncementType {
  Info = 'info',
  Warning = 'warning',
  Urgent = 'urgent',
  Success = 'success',
}

@Schema({ timestamps: true })
export class Announcement {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: String, trim: true, default: null })
  link: string | null;

  @Prop({
    required: true,
    enum: AnnouncementTarget,
    default: AnnouncementTarget.All,
    index: true,
  })
  targetAudience: AnnouncementTarget;

  @Prop({
    required: true,
    enum: AnnouncementType,
    default: AnnouncementType.Info,
  })
  type: AnnouncementType;

  @Prop({ required: true, type: Date, index: true })
  startDate: Date;

  @Prop({ required: true, type: Date, index: true })
  endDate: Date;

  @Prop({ required: true, type: Boolean, default: true, index: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);

AnnouncementSchema.index({ isActive: 1, startDate: 1, endDate: 1, targetAudience: 1 });

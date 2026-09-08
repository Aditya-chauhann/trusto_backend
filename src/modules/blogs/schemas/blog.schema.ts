import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BlogDocument = HydratedDocument<Blog>;

export enum BlogStatus {
  Draft = 'draft',
  Published = 'published',
}

@Schema({ timestamps: true })
export class Blog {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true, index: true })
  slug: string;

  @Prop({ required: true, trim: true })
  excerpt: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: String, trim: true, default: null })
  coverImageUrl: string | null;

  @Prop({
    required: true,
    enum: BlogStatus,
    default: BlogStatus.Draft,
    index: true,
  })
  status: BlogStatus;

  @Prop({ type: Date, default: null, index: true })
  publishedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId: Types.ObjectId;

  @Prop({ type: String, trim: true, default: null })
  metaTitle: string | null;

  @Prop({ type: String, trim: true, default: null })
  metaDescription: string | null;
}

export const BlogSchema = SchemaFactory.createForClass(Blog);

BlogSchema.index({ status: 1, publishedAt: -1 });

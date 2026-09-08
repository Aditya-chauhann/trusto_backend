import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UpiAccountDocument = HydratedDocument<UpiAccount>;

export enum UpiAccountApprovalStatus {
  Approved = 'approved',
  Pending = 'pending',
  Rejected = 'rejected',
}

@Schema({ timestamps: true })
export class UpiAccount {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  // The UPI VPA / handle, e.g. "name@bank". Stored lower-cased.
  @Prop({ required: true, lowercase: true, trim: true })
  upiId: string;

  @Prop({ trim: true })
  accountHolderName?: string;

  @Prop({ default: false })
  isDefault: boolean;

  // User-controlled active/inactive toggle. Inactive UPIs stay saved and
  // visible but cannot be used for withdrawals. Legacy rows without this field
  // are treated as active.
  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({
    type: String,
    enum: UpiAccountApprovalStatus,
    default: UpiAccountApprovalStatus.Approved,
    index: true,
  })
  approvalStatus: UpiAccountApprovalStatus;

  // When this UPI is a duplicate of one another user added first, this is the
  // original (first) owner who must approve it. Null for non-shared UPIs.
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  approvalRequiredFrom: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  approvedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  approvedAt: Date | null;

  @Prop({ type: Date, default: null })
  rejectedAt: Date | null;

  @Prop({ default: false, index: true })
  isDeleted: boolean;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export const UpiAccountSchema = SchemaFactory.createForClass(UpiAccount);

UpiAccountSchema.index({ userId: 1, upiId: 1 }, { unique: true });

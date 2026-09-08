import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BankAccountDocument = HydratedDocument<BankAccount>;

export enum BankAccountApprovalStatus {
  Approved = 'approved',
  Pending = 'pending',
  Rejected = 'rejected',
}

@Schema({ timestamps: true })
export class BankAccount {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  accountHolderName: string;

  @Prop({ required: true, trim: true })
  accountNumber: string;

  @Prop({ required: true, uppercase: true, trim: true })
  ifscCode: string;

  @Prop({ trim: true })
  bankName?: string;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({
    type: String,
    enum: BankAccountApprovalStatus,
    default: BankAccountApprovalStatus.Approved,
    index: true,
  })
  approvalStatus: BankAccountApprovalStatus;

  // When this account is a duplicate of one another user added first, this is
  // the original (first) owner who must approve it. Null for non-shared accounts.
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

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);

BankAccountSchema.index(
  { userId: 1, accountNumber: 1, ifscCode: 1 },
  { unique: true },
);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StaffTeam } from '../../staff/schemas/staff-role.schema';

export type TicketDocument = HydratedDocument<Ticket>;

export enum TicketAssignmentStatus {
  Unassigned = 'unassigned',
  Assigned = 'assigned',
}

export enum TicketResolutionStatus {
  Pending = 'pending',
  Resolved = 'resolved',
}

export enum TicketCreatorType {
  User = 'user',
  Staff = 'staff',
}

@Schema({ timestamps: true })
export class Ticket {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    required: true,
    type: String,
    enum: TicketCreatorType,
    default: TicketCreatorType.User,
    index: true,
  })
  createdByType: TicketCreatorType;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({
    required: true,
    type: String,
    enum: StaffTeam,
    default: StaffTeam.Support,
    index: true,
  })
  team: StaffTeam;

  @Prop({
    required: true,
    type: String,
    enum: TicketAssignmentStatus,
    default: TicketAssignmentStatus.Unassigned,
    index: true,
  })
  assignmentStatus: TicketAssignmentStatus;

  @Prop({ type: Types.ObjectId, ref: 'StaffUser', default: null, index: true })
  assigneeId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  assignedAt: Date | null;

  @Prop({
    required: true,
    type: String,
    enum: TicketResolutionStatus,
    default: TicketResolutionStatus.Pending,
    index: true,
  })
  resolutionStatus: TicketResolutionStatus;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'StaffUser', default: null })
  resolvedBy: Types.ObjectId | null;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);

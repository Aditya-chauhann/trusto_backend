import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Ticket,
  TicketAssignmentStatus,
  TicketCreatorType,
  TicketDocument,
  TicketResolutionStatus,
} from './schemas/ticket.schema';
import { StaffTeam } from '../staff/schemas/staff-role.schema';
import {
  StaffUser,
  StaffUserDocument,
} from '../staff/schemas/staff-user.schema';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateStaffTicketDto } from './dto/create-staff-ticket.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationEvent } from '../notifications/notification-events';

export interface TicketResponse {
  id: string;
  userId: string;
  createdByType: TicketCreatorType;
  title: string;
  description: string;
  team: StaffTeam;
  assignmentStatus: TicketAssignmentStatus;
  assignee: { id: string; fullName: string; email: string } | null;
  assignedAt: string | null;
  resolutionStatus: TicketResolutionStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ListTicketsOptions {
  page?: number;
  limit?: number;
  team?: StaffTeam;
  assignmentStatus?: TicketAssignmentStatus;
  resolutionStatus?: TicketResolutionStatus;
  assigneeId?: string;
  userId?: string;
}

export interface ListTicketsResult {
  items: TicketResponse[];
  total: number;
  page: number;
  limit: number;
}

export interface StaffViewer {
  id: string;
  isSuperAdmin: boolean;
  team: StaffTeam | null;
}

@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(StaffUser.name)
    private readonly staffModel: Model<StaffUserDocument>,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────── user side ─────────

  async createForUser(
    userId: string,
    dto: CreateTicketDto,
  ): Promise<TicketResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const doc = await this.ticketModel.create({
      userId: new Types.ObjectId(userId),
      createdByType: TicketCreatorType.User,
      title: dto.title.trim(),
      description: dto.description.trim(),
      team: StaffTeam.Support,
      assignmentStatus: TicketAssignmentStatus.Unassigned,
      resolutionStatus: TicketResolutionStatus.Pending,
    });
    void this.notifications.notify(
      doc.userId,
      NotificationEvent.TicketRaised,
      {
        ticketId: (doc._id as Types.ObjectId).toString(),
        title: doc.title,
      },
    );
    return this.toResponse(doc, null);
  }

  async createForStaff(
    staffId: string,
    dto: CreateStaffTicketDto,
  ): Promise<TicketResponse> {
    if (!Types.ObjectId.isValid(staffId)) {
      throw new BadRequestException('Invalid staff id');
    }
    const doc = await this.ticketModel.create({
      userId: new Types.ObjectId(staffId),
      createdByType: TicketCreatorType.Staff,
      title: dto.title.trim(),
      description: dto.description.trim(),
      team: dto.team,
      assignmentStatus: TicketAssignmentStatus.Unassigned,
      resolutionStatus: TicketResolutionStatus.Pending,
    });
    return this.toResponse(doc, null);
  }

  async listForUser(userId: string, limit = 50): Promise<TicketResponse[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const docs = await this.ticketModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(safeLimit);
    return this.hydrateMany(docs);
  }

  async getOwnedByUser(
    userId: string,
    ticketId: string,
  ): Promise<TicketResponse> {
    if (!Types.ObjectId.isValid(ticketId)) {
      throw new BadRequestException('Invalid ticket id');
    }
    const doc = await this.ticketModel.findOne({
      _id: new Types.ObjectId(ticketId),
      userId: new Types.ObjectId(userId),
    });
    if (!doc) throw new NotFoundException('Ticket not found');
    return (await this.hydrateMany([doc]))[0];
  }

  // ───────── staff side ─────────

  async listForStaff(
    viewer: StaffViewer,
    opts: ListTicketsOptions,
  ): Promise<ListTicketsResult> {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

    const filter: FilterQuery<TicketDocument> = {};
    this.scopeFilterToViewer(filter, viewer, opts.team);

    if (opts.assignmentStatus) filter.assignmentStatus = opts.assignmentStatus;
    if (opts.resolutionStatus) filter.resolutionStatus = opts.resolutionStatus;
    if (opts.assigneeId) {
      if (!Types.ObjectId.isValid(opts.assigneeId)) {
        throw new BadRequestException('Invalid assigneeId');
      }
      filter.assigneeId = new Types.ObjectId(opts.assigneeId);
    }
    if (opts.userId) {
      if (!Types.ObjectId.isValid(opts.userId)) {
        throw new BadRequestException('Invalid userId');
      }
      filter.userId = new Types.ObjectId(opts.userId);
    }

    const [docs, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .sort({ resolutionStatus: 1, assignmentStatus: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.ticketModel.countDocuments(filter),
    ]);

    return {
      items: await this.hydrateMany(docs),
      total,
      page,
      limit,
    };
  }

  async getForStaff(
    viewer: StaffViewer,
    ticketId: string,
  ): Promise<TicketResponse> {
    const doc = await this.loadVisibleTicket(viewer, ticketId);
    return (await this.hydrateMany([doc]))[0];
  }

  async assignToMe(
    viewer: StaffViewer,
    ticketId: string,
  ): Promise<TicketResponse> {
    const doc = await this.loadVisibleTicket(viewer, ticketId);

    if (!viewer.isSuperAdmin && viewer.team !== doc.team) {
      throw new ForbiddenException(
        'You can only pick up tickets for your own team',
      );
    }
    if (doc.resolutionStatus === TicketResolutionStatus.Resolved) {
      throw new BadRequestException(
        'Cannot assign a resolved ticket. Reopen it first.',
      );
    }
    if (doc.assignmentStatus === TicketAssignmentStatus.Assigned) {
      throw new BadRequestException(
        'Ticket is already assigned to someone else',
      );
    }

    doc.assignmentStatus = TicketAssignmentStatus.Assigned;
    doc.assigneeId = new Types.ObjectId(viewer.id);
    doc.assignedAt = new Date();
    await doc.save();
    return (await this.hydrateMany([doc]))[0];
  }

  async transferTeam(
    viewer: StaffViewer,
    ticketId: string,
    target: StaffTeam,
  ): Promise<TicketResponse> {
    const doc = await this.loadVisibleTicket(viewer, ticketId);

    if (doc.resolutionStatus === TicketResolutionStatus.Resolved) {
      throw new BadRequestException('Cannot transfer a resolved ticket');
    }
    if (doc.team === target) {
      throw new BadRequestException(
        `Ticket is already on the ${target} team`,
      );
    }
    if (!viewer.isSuperAdmin) {
      if (viewer.team !== doc.team) {
        throw new ForbiddenException(
          'You can only transfer tickets for your own team',
        );
      }
      if (
        !doc.assigneeId ||
        doc.assigneeId.toString() !== viewer.id
      ) {
        throw new ForbiddenException(
          'Only the current assignee can transfer this ticket',
        );
      }
    }

    doc.team = target;
    doc.assignmentStatus = TicketAssignmentStatus.Unassigned;
    doc.assigneeId = null;
    doc.assignedAt = null;
    await doc.save();
    return (await this.hydrateMany([doc]))[0];
  }

  async resolve(
    viewer: StaffViewer,
    ticketId: string,
  ): Promise<TicketResponse> {
    const doc = await this.loadVisibleTicket(viewer, ticketId);

    if (doc.resolutionStatus === TicketResolutionStatus.Resolved) {
      throw new BadRequestException('Ticket is already resolved');
    }
    if (doc.assignmentStatus !== TicketAssignmentStatus.Assigned) {
      throw new BadRequestException(
        'Assign the ticket to someone before resolving it',
      );
    }
    if (!viewer.isSuperAdmin) {
      if (
        !doc.assigneeId ||
        doc.assigneeId.toString() !== viewer.id
      ) {
        throw new ForbiddenException(
          'Only the current assignee can resolve this ticket',
        );
      }
    }

    doc.resolutionStatus = TicketResolutionStatus.Resolved;
    doc.resolvedAt = new Date();
    doc.resolvedBy = new Types.ObjectId(viewer.id);
    await doc.save();
    if (doc.createdByType === TicketCreatorType.User) {
      void this.notifications.notify(
        doc.userId,
        NotificationEvent.TicketResolved,
        {
          ticketId: (doc._id as Types.ObjectId).toString(),
          title: doc.title,
        },
      );
    }
    return (await this.hydrateMany([doc]))[0];
  }

  // ───────── helpers ─────────

  private async loadVisibleTicket(
    viewer: StaffViewer,
    ticketId: string,
  ): Promise<TicketDocument> {
    if (!Types.ObjectId.isValid(ticketId)) {
      throw new BadRequestException('Invalid ticket id');
    }
    const doc = await this.ticketModel.findById(ticketId);
    if (!doc) throw new NotFoundException('Ticket not found');

    if (!viewer.isSuperAdmin) {
      if (!viewer.team) {
        throw new ForbiddenException(
          'Your role has no team. Ask a super admin to assign your role to support or tech.',
        );
      }
      if (viewer.team !== doc.team) {
        throw new ForbiddenException(
          'This ticket belongs to a different team',
        );
      }
    }
    return doc;
  }

  private scopeFilterToViewer(
    filter: FilterQuery<TicketDocument>,
    viewer: StaffViewer,
    explicitTeam: StaffTeam | undefined,
  ): void {
    if (viewer.isSuperAdmin) {
      if (explicitTeam) filter.team = explicitTeam;
      return;
    }
    if (!viewer.team) {
      // Force an empty result set for staff with no team.
      filter.team = '__no_team__' as unknown as StaffTeam;
      return;
    }
    filter.team = viewer.team;
  }

  private async hydrateMany(docs: TicketDocument[]): Promise<TicketResponse[]> {
    const assigneeIds = Array.from(
      new Set(
        docs
          .map((d) => d.assigneeId?.toString())
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const assignees = assigneeIds.length
      ? await this.staffModel
          .find({ _id: { $in: assigneeIds } })
          .select('fullName email')
      : [];
    const map = new Map<
      string,
      { id: string; fullName: string; email: string }
    >();
    assignees.forEach((a) =>
      map.set((a._id as Types.ObjectId).toString(), {
        id: (a._id as Types.ObjectId).toString(),
        fullName: a.fullName,
        email: a.email,
      }),
    );
    return docs.map((d) =>
      this.toResponse(d, d.assigneeId ? map.get(d.assigneeId.toString()) ?? null : null),
    );
  }

  private toResponse(
    doc: TicketDocument,
    assignee: { id: string; fullName: string; email: string } | null,
  ): TicketResponse {
    const ts = doc as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (doc._id as Types.ObjectId).toString(),
      userId: doc.userId.toString(),
      createdByType: doc.createdByType,
      title: doc.title,
      description: doc.description,
      team: doc.team,
      assignmentStatus: doc.assignmentStatus,
      assignee,
      assignedAt: doc.assignedAt ? doc.assignedAt.toISOString() : null,
      resolutionStatus: doc.resolutionStatus,
      resolvedAt: doc.resolvedAt ? doc.resolvedAt.toISOString() : null,
      resolvedBy: doc.resolvedBy ? doc.resolvedBy.toString() : null,
      createdAt: ts.createdAt ? ts.createdAt.toISOString() : null,
      updatedAt: ts.updatedAt ? ts.updatedAt.toISOString() : null,
    };
  }
}

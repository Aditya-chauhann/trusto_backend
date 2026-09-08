import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { StaffTeam } from '../staff/schemas/staff-role.schema';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { TicketsService } from './tickets.service';
import { TransferTicketDto } from './dto/transfer-ticket.dto';
import { CreateStaffTicketDto } from './dto/create-staff-ticket.dto';
import {
  TicketAssignmentStatus,
  TicketResolutionStatus,
} from './schemas/ticket.schema';

function parseTeam(value?: string): StaffTeam | undefined {
  if (value === undefined) return undefined;
  if (value === StaffTeam.Support || value === StaffTeam.Tech) return value;
  throw new BadRequestException(`Invalid team "${value}"`);
}

function parseAssignment(
  value?: string,
): TicketAssignmentStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === TicketAssignmentStatus.Unassigned ||
    value === TicketAssignmentStatus.Assigned
  ) {
    return value;
  }
  throw new BadRequestException(`Invalid assignmentStatus "${value}"`);
}

function parseResolution(
  value?: string,
): TicketResolutionStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === TicketResolutionStatus.Pending ||
    value === TicketResolutionStatus.Resolved
  ) {
    return value;
  }
  throw new BadRequestException(`Invalid resolutionStatus "${value}"`);
}

@Controller('admin/tickets')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Tickets)
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  create(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: CreateStaffTicketDto,
  ) {
    return this.tickets.createForStaff(current.id, dto);
  }

  @Get()
  list(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('team') team?: string,
    @Query('assignmentStatus') assignmentStatus?: string,
    @Query('resolutionStatus') resolutionStatus?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.tickets.listForStaff(
      {
        id: current.id,
        isSuperAdmin: current.isSuperAdmin,
        team: current.team ?? null,
      },
      {
        page,
        limit,
        team: parseTeam(team),
        assignmentStatus: parseAssignment(assignmentStatus),
        resolutionStatus: parseResolution(resolutionStatus),
        assigneeId,
        userId,
      },
    );
  }

  @Get(':id')
  getOne(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.tickets.getForStaff(
      {
        id: current.id,
        isSuperAdmin: current.isSuperAdmin,
        team: current.team ?? null,
      },
      id,
    );
  }

  @Post(':id/assign-to-me')
  assignToMe(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.tickets.assignToMe(
      {
        id: current.id,
        isSuperAdmin: current.isSuperAdmin,
        team: current.team ?? null,
      },
      id,
    );
  }

  @Post(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferTicketDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.tickets.transferTeam(
      {
        id: current.id,
        isSuperAdmin: current.isSuperAdmin,
        team: current.team ?? null,
      },
      id,
      dto.team,
    );
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.tickets.resolve(
      {
        id: current.id,
        isSuperAdmin: current.isSuperAdmin,
        team: current.team ?? null,
      },
      id,
    );
  }
}

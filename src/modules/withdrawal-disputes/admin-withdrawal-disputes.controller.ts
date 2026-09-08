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
import {
  TicketAssignmentStatus,
  TicketResolutionStatus,
} from '../tickets/schemas/ticket.schema';
import { WithdrawalDisputesService } from './withdrawal-disputes.service';
import { TransferDisputeDto } from './dto/transfer-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { ApproveDisputeDto } from './dto/approve-dispute.dto';
import { DeclineDisputeDto } from './dto/decline-dispute.dto';

function parseTeam(value?: string): StaffTeam | undefined {
  if (value === undefined) return undefined;
  if (value === StaffTeam.Support || value === StaffTeam.Tech) return value;
  throw new BadRequestException(`Invalid team "${value}"`);
}

function parseAssignment(value?: string): TicketAssignmentStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === TicketAssignmentStatus.Unassigned ||
    value === TicketAssignmentStatus.Assigned
  ) {
    return value;
  }
  throw new BadRequestException(`Invalid assignmentStatus "${value}"`);
}

function parseResolution(value?: string): TicketResolutionStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === TicketResolutionStatus.Pending ||
    value === TicketResolutionStatus.Resolved
  ) {
    return value;
  }
  throw new BadRequestException(`Invalid resolutionStatus "${value}"`);
}

@Controller('admin/withdrawal-disputes')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Tickets)
export class AdminWithdrawalDisputesController {
  constructor(private readonly disputes: WithdrawalDisputesService) {}

  private viewer(current: AuthenticatedRequestUser) {
    return {
      id: current.id,
      isSuperAdmin: current.isSuperAdmin,
      team: current.team ?? null,
    };
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
    return this.disputes.listForStaff(this.viewer(current), {
      page,
      limit,
      team: parseTeam(team),
      assignmentStatus: parseAssignment(assignmentStatus),
      resolutionStatus: parseResolution(resolutionStatus),
      assigneeId,
      userId,
    });
  }

  @Get(':id')
  getOne(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.disputes.getForStaff(this.viewer(current), id);
  }

  @Post(':id/assign-to-me')
  assignToMe(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.disputes.assignToMe(this.viewer(current), id);
  }

  @Post(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferDisputeDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.disputes.transferTeam(this.viewer(current), id, dto.team);
  }

  // Close the dispute (resolve), like resolving any other ticket.
  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.disputes.resolve(this.viewer(current), id, dto.resolutionNotes);
  }

  // Super admin: APPROVE the dispute (user was right) — apply a credit/debit to
  // the user's balance; transaction moves pending → resolved.
  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveDisputeDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.disputes.approveDispute(this.viewer(current), id, {
      amountUsdt: dto.amountUsdt,
      direction: dto.direction,
      resolutionNotes: dto.resolutionNotes,
    });
  }

  // Super admin: DECLINE the dispute (it was false) — no balance change;
  // transaction moves pending → paid (successful).
  @Post(':id/decline')
  decline(
    @Param('id') id: string,
    @Body() dto: DeclineDisputeDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.disputes.declineDispute(
      this.viewer(current),
      id,
      dto.resolutionNotes,
    );
  }
}

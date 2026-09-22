import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { UserRole } from '../users/schemas/user.schema';
import { AdminUsersService } from './admin-users.service';
import { ModerationActionDto } from './dto/moderation.dto';
import { AssignAgentDto } from './dto/assign-agent.dto';
import { SetReferralDto } from './dto/set-referral.dto';
import { AdjustBalanceDto } from './dto/adjust-balance.dto';
import { AdminResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdatePhoneDto } from './dto/update-phone.dto';

function parseBool(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`Expected true|false, got "${value}"`);
}

function parseRole(value?: string): UserRole | undefined {
  if (value === undefined) return undefined;
  if (value === UserRole.User || value === UserRole.Admin || value === UserRole.SuperAdmin) {
    return value;
  }
  throw new BadRequestException(`Invalid role "${value}"`);
}

@Controller('admin/users')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Users)
export class AdminUsersController {
  constructor(private readonly admin: AdminUsersService) { }

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('blocked') blocked?: string,
    @Query('frozen') frozen?: string,
    @Query('onWatch') onWatch?: string,
    @Query('smartUpi') smartUpi?: string,
  ) {
    return this.admin.listAll({
      page,
      limit,
      search,
      role: parseRole(role),
      blocked: parseBool(blocked),
      frozen: parseBool(frozen),
      onWatch: parseBool(onWatch),
      smartUpi: parseBool(smartUpi),
    });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.admin.getById(id);
  }

  @Post(':id/block')
  block(
    @Param('id') id: string,
    @CurrentUser() current: { id: string },
    @Body() dto: ModerationActionDto,
  ) {
    return this.admin.setBlocked(id, true, current.id, dto.reason);
  }

  @Post(':id/unblock')
  unblock(
    @Param('id') id: string,
    @CurrentUser() current: { id: string },
  ) {
    return this.admin.setBlocked(id, false, current.id);
  }

  @Post(':id/freeze')
  freeze(
    @Param('id') id: string,
    @CurrentUser() current: { id: string },
    @Body() dto: ModerationActionDto,
  ) {
    return this.admin.setFrozen(id, true, current.id, dto.reason);
  }

  @Post(':id/unfreeze')
  unfreeze(
    @Param('id') id: string,
    @CurrentUser() current: { id: string },
  ) {
    return this.admin.setFrozen(id, false, current.id);
  }

  @Post(':id/watch')
  @UseGuards(SuperAdminGuard)
  watch(
    @Param('id') id: string,
    @CurrentUser() current: { id: string },
    @Body() dto: ModerationActionDto,
  ) {
    return this.admin.setOnWatch(id, true, current.id, dto.reason);
  }

  @Post(':id/unwatch')
  @UseGuards(SuperAdminGuard)
  unwatch(
    @Param('id') id: string,
    @CurrentUser() current: { id: string },
  ) {
    return this.admin.setOnWatch(id, false, current.id);
  }

  @Patch(':id/assigned-agent')
  assignAgent(
    @Param('id') id: string,
    @Body() dto: AssignAgentDto,
    @CurrentUser() current: { id: string },
  ) {
    return this.admin.assignAgent(id, dto.agentId, current.id);
  }

  @Patch(':id/referral')
  setReferral(
    @Param('id') id: string,
    @Body() dto: SetReferralDto,
    @CurrentUser() current: { id: string },
  ) {
    return this.admin.setReferral(id, dto.referralCode, current.id);
  }

  @Patch(':id/phone')
  @UseGuards(SuperAdminGuard)
  updatePhone(
    @Param('id') id: string,
    @Body() dto: UpdatePhoneDto,
    @CurrentUser() current: { id: string },
  ) {
    return this.admin.updatePhone(id, dto.phone, current.id);
  }

  @Post(':id/adjust-balance')
  @UseGuards(SuperAdminGuard)
  adjustBalance(
    @Param('id') id: string,
    @Body() dto: AdjustBalanceDto,
    @CurrentUser() current: { id: string },
  ) {
    return this.admin.adjustBalance(id, dto, current.id);
  }

  @Post(':id/subscribe-wallet')
  @UseGuards(SuperAdminGuard)
  subscribeWallet(@Param('id') id: string) {
    return this.admin.subscribeWallet(id);
  }

  @Post(':id/disable-smart-upi')
  disableSmartUpi(@Param('id') id: string) {
    return this.admin.setSmartUpi(id, false);
  }

  @Post(':id/smart-upi')
  setSmartUpi(
    @Param('id') id: string,
    @Body() dto: { enabled: boolean },
  ) {
    return this.admin.setSmartUpi(id, dto.enabled ?? false);
  }

  @Post(':id/reset-password')
  @UseGuards(SuperAdminGuard)
  resetPassword(
    @Param('id') id: string,
    @Body() dto: AdminResetUserPasswordDto,
    @CurrentUser() current: { id: string },
  ) {
    return this.admin.resetUserPassword(id, dto, current.id);
  }
}

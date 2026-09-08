import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminOnly } from '../../common/decorators/superadmin-only.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { StaffUsersService } from './staff-users.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ResetStaffPasswordDto } from './dto/reset-staff-password.dto';

function parseBool(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`Expected true|false, got "${value}"`);
}

@Controller('admin/staff')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@SuperAdminOnly()
export class StaffUsersController {
  constructor(private readonly staff: StaffUsersService) {}

  @Post()
  create(
    @Body() dto: CreateStaffDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.staff.create(dto, current.id);
  }

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('roleId') roleId?: string,
    @Query('active') active?: string,
  ) {
    return this.staff.list({
      page,
      limit,
      search,
      roleId,
      active: parseBool(active),
    });
  }

  @Get('by-code/:code')
  getByCode(@Param('code') code: string) {
    return this.staff.getByAgentCode(code);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.staff.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(id, dto);
  }

  @Post(':id/reset-password')
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetStaffPasswordDto,
  ) {
    return this.staff.resetPassword(id, dto);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.staff.setActive(id, true);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.staff.setActive(id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() current: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.staff.remove(id, current.id);
  }
}

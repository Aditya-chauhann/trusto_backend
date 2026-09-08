import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SuperAdminOnly } from '../../common/decorators/superadmin-only.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { StaffRolesService } from './staff-roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PERMISSION_CATALOG } from './permissions.constants';

@Controller('admin/roles')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@SuperAdminOnly()
export class StaffRolesController {
  constructor(private readonly roles: StaffRolesService) {}

  @Post()
  create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.roles.create(dto, current.id);
  }

  @Get()
  list() {
    return this.roles.list();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.roles.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.roles.remove(id);
  }
}

@Controller('admin/permissions')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@SuperAdminOnly()
export class PermissionsCatalogController {
  @Get()
  list() {
    return { items: PERMISSION_CATALOG };
  }
}

import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { PERMISSIONS } from '../staff/permissions.constants';
import { SystemControlsService } from './system-controls.service';
import { UpdateSystemControlsDto } from './dto/update-system-controls.dto';

@Controller('admin/system-controls')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Settings)
export class AdminSystemControlsController {
  constructor(private readonly controls: SystemControlsService) {}

  @Get()
  get() {
    return this.controls.get();
  }

  @Patch()
  update(
    @Body() dto: UpdateSystemControlsDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.controls.update(dto, { id: current.id, type: current.type });
  }
}

@Controller('system-controls')
export class PublicSystemControlsController {
  constructor(private readonly controls: SystemControlsService) {}

  @Get()
  get() {
    return this.controls.getPublic();
  }
}

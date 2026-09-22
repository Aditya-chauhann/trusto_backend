import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
export class AdminSystemControlsController {
  constructor(private readonly controls: SystemControlsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.Settings)
  get() {
    return this.controls.get();
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.Settings)
  update(
    @Body() dto: UpdateSystemControlsDto,
    @CurrentUser() current: AuthenticatedRequestUser,
  ) {
    return this.controls.update(dto, { id: current.id, type: current.type });
  }

  @Get('csv-presets')
  getCsvPresets() {
    return this.controls.getCsvPresets();
  }

  @Post('csv-presets')
  saveCsvPreset(@Body() body: { filename: string; columns: string[] }) {
    return this.controls.saveCsvPreset(body?.filename, body?.columns);
  }

  @Delete('csv-presets/:filename')
  resetCsvPreset(@Param('filename') filename: string) {
    return this.controls.resetCsvPreset(filename);
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

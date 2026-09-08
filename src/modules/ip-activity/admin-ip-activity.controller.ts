import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { IpActivityService } from './ip-activity.service';

@Controller('admin/ip-activities')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.IpActivities)
export class AdminIpActivityController {
  constructor(private readonly ipActivityService: IpActivityService) {}

  @Get()
  list(
    @Query('actionType') actionType?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ipActivityService.listAll({
      actionType,
      q,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('block')
  block(@Body() body: { ip: string; reason?: string; durationHours?: number }) {
    return this.ipActivityService.blockIp(body.ip, body.reason, body.durationHours);
  }

  @Post('unblock')
  unblock(@Body() body: { ip: string }) {
    return this.ipActivityService.unblockIp(body.ip);
  }
}

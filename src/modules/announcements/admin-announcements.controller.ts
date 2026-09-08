import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../staff/permissions.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

@Controller('admin/announcements')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Announcements)
export class AdminAnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  async listAll() {
    return this.announcementsService.listAll();
  }

  @Get('settings')
  async getSettings() {
    return this.announcementsService.getSettings();
  }

  @Put('settings')
  async updateSettings(@Body() dto: UpdateNotificationSettingsDto) {
    return this.announcementsService.updateSettings(dto);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.announcementsService.getById(id);
  }

  @Post()
  async create(
    @CurrentUser() current: { id: string },
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcementsService.create(current.id, dto);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcementsService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.announcementsService.remove(id);
  }
}

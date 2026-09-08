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
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async listForUser(@CurrentUser() current: AuthenticatedRequestUser) {
    return this.notifications.listForUser(current.id);
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() current: AuthenticatedRequestUser) {
    const count = await this.notifications.getUnreadCount(current.id);
    return { count };
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Param('id') id: string,
  ) {
    await this.notifications.markRead(current.id, id);
    return { success: true };
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() current: AuthenticatedRequestUser) {
    await this.notifications.markAllRead(current.id);
    return { success: true };
  }

  @Delete(':id')
  async deleteOne(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Param('id') id: string,
  ) {
    await this.notifications.deleteOne(current.id, id);
    return { success: true };
  }

  @Delete()
  async deleteAll(@CurrentUser() current: AuthenticatedRequestUser) {
    await this.notifications.deleteAll(current.id);
    return { success: true };
  }
}

@Controller('user/notification-preference')
@UseGuards(AuthGuard('jwt'))
export class NotificationPreferenceController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  get(@CurrentUser() current: AuthenticatedRequestUser) {
    return this.notifications.getPreference(current.id);
  }

  @Patch()
  update(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notifications.setPreference(current.id, dto.channel);
  }
}

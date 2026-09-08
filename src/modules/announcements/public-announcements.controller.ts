import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AnnouncementsService } from './announcements.service';

@Controller('announcements')
export class PublicAnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get('active')
  @UseGuards(AuthGuard('jwt'))
  async getActive(@Req() req: any) {
    const isStaff = req.user?.isStaff || req.user?.type === 'staff';
    const scope = isStaff ? 'staff' : 'users';
    return this.announcementsService.listActiveForScope(scope);
  }
}

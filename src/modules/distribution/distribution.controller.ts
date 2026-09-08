import { Controller, Get, UseGuards, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { DistributionService } from './distribution.service';

@Controller(['user/distribution', 'admin/distribution'])
@UseGuards(AuthGuard('jwt'))
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  @Get()
  async getDistribution(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.distributionService.getDistributionStats(user.id);
  }

  @Get(':inviteeId')
  async getInviteeTimeline(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('inviteeId') inviteeId: string,
  ) {
    return this.distributionService.getInviteeTimeline(user.id, inviteeId);
  }
}

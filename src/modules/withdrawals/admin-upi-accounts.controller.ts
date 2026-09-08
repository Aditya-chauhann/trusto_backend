import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { UpiAccountsService } from './upi-accounts.service';

@Controller('admin/users')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Withdrawals)
export class AdminUpiAccountsController {
  constructor(private readonly upiAccounts: UpiAccountsService) {}

  @Get(':userId/upi-accounts')
  list(@Param('userId') userId: string) {
    return this.upiAccounts.listForUser(userId);
  }
}

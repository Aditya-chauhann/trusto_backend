import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { BankAccountsService } from './bank-accounts.service';

@Controller('admin/users')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Withdrawals)
export class AdminBankAccountsController {
  constructor(private readonly bankAccounts: BankAccountsService) {}

  @Get(':userId/bank-accounts')
  list(@Param('userId') userId: string) {
    return this.bankAccounts.listForUser(userId);
  }
}

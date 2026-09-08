import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { DepositsService } from './deposits.service';

@Controller('admin/deposits')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Deposits)
export class AdminDepositsController {
  constructor(private readonly deposits: DepositsService) {}

  @Get()
  list() {
    return this.deposits.listAllForAdmin();
  }
}

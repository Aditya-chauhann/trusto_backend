import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS } from '../staff/permissions.constants';
import { WithdrawalsService } from './withdrawals.service';
import {
  WithdrawalMethod,
  WithdrawalStatus,
} from './schemas/withdrawal.schema';
import {
  ApproveWithdrawalDto,
  RejectWithdrawalDto,
} from './dto/withdrawal-decision.dto';

function parseStatus(value?: string): WithdrawalStatus | undefined {
  if (value === undefined) return undefined;
  if (
    value === WithdrawalStatus.Pending ||
    value === WithdrawalStatus.Processing ||
    value === WithdrawalStatus.Paid ||
    value === WithdrawalStatus.Failed ||
    value === WithdrawalStatus.AwaitingPayment ||
    value === WithdrawalStatus.Resolved
  ) {
    return value;
  }
  throw new BadRequestException(`Invalid status "${value}"`);
}

function parseMethod(value?: string): WithdrawalMethod | undefined {
  if (value === undefined) return undefined;
  if (
    value === WithdrawalMethod.Bank ||
    value === WithdrawalMethod.Upi ||
    value === WithdrawalMethod.Crypto
  ) {
    return value;
  }
  throw new BadRequestException(`Invalid method "${value}"`);
}

@Controller('admin/withdrawals')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequirePermissions(PERMISSIONS.Withdrawals)
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('method') method?: string,
  ) {
    return this.withdrawals.listAllForAdmin({
      page,
      limit,
      userId,
      status: parseStatus(status),
      method: parseMethod(method),
    });
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() current: { id: string },
    @Body() dto: ApproveWithdrawalDto,
  ) {
    return this.withdrawals.approve(
      id,
      current.id,
      dto.reason,
      dto.txHash,
      dto.utr,
    );
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() current: { id: string },
    @Body() dto: RejectWithdrawalDto,
  ) {
    return this.withdrawals.reject(id, current.id, dto.reason);
  }
}

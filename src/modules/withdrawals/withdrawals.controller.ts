import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WithdrawalsService } from './withdrawals.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { IpBlockService } from '../ip-block/ip-block.service';

const MAX_LIMIT = 200;

@Controller('user/withdrawals')
export class WithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly ipBlockService: IpBlockService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Post()
  create(
    @Req() req: Request,
    @CurrentUser() current: { id: string },
    @Body() dto: CreateWithdrawalDto,
  ) {
    const ip = this.ipBlockService.getClientIp(req);
    return this.withdrawals.create(current.id, dto, ip);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  list(
    @CurrentUser() current: { id: string },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    return this.withdrawals.listForUser(current.id, safeLimit);
  }

  // Only this user's Smart auto-liquidation payouts (for the dedicated Smart screen).
  @UseGuards(AuthGuard('jwt'))
  @Get('smart')
  listSmart(
    @CurrentUser() current: { id: string },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    return this.withdrawals.listSmartForUser(current.id, safeLimit);
  }

  // Decline a smart auto-liquidation match within the 5-minute window (before
  // the payer pays). Only valid while the transaction is awaiting payment.
  @UseGuards(AuthGuard('jwt'))
  @Post(':id/decline')
  decline(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
  ) {
    return this.withdrawals.declineSmartMatch(current.id, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/confirm-received')
  confirmReceived(
    @CurrentUser() current: { id: string },
    @Param('id') id: string,
  ) {
    return this.withdrawals.confirmReceived(current.id, id);
  }
}

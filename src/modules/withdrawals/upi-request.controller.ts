import { Body, Controller, Post, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateUpiRequestDto } from './dto/create-upi-request.dto';
import { WithdrawalsService } from './withdrawals.service';
import { IpBlockService } from '../ip-block/ip-block.service';

@Controller('user')
export class UpiRequestController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly ipBlockService: IpBlockService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('upiRequest')
  create(
    @Req() req: Request,
    @CurrentUser() current: { id: string },
    @Body() dto: CreateUpiRequestDto,
  ) {
    const ip = this.ipBlockService.getClientIp(req);
    return this.withdrawals.createFromUpiRequest(current.id, dto, ip);
  }
}

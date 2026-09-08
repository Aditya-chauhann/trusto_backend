import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { WithdrawalPinService } from './withdrawal-pin.service';
import { SetPinDto } from './dto/set-pin.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { ResetPinConfirmDto } from './dto/reset-pin-confirm.dto';

@Controller('user/withdrawal-pin')
@UseGuards(AuthGuard('jwt'))
export class WithdrawalPinController {
  constructor(private readonly service: WithdrawalPinService) {}

  @Get('status')
  status(@CurrentUser() current: AuthenticatedRequestUser) {
    return this.service.getStatus(current.id);
  }

  @Post('set')
  set(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: SetPinDto,
  ) {
    return this.service.setPin(current.id, dto);
  }

  @Post('change')
  change(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: ChangePinDto,
  ) {
    return this.service.changePin(current.id, dto);
  }

  @Post('reset/request')
  requestReset(@CurrentUser() current: AuthenticatedRequestUser) {
    return this.service.requestReset(current.id);
  }

  @Post('reset/confirm')
  confirmReset(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: ResetPinConfirmDto,
  ) {
    return this.service.confirmReset(current.id, dto);
  }
}

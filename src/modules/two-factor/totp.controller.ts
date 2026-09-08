import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TotpService } from './totp.service';
import { EnableTotpDto } from './dto/enable-totp.dto';
import { DisableTotpDto } from './dto/disable-totp.dto';
import type { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

@Controller('auth/totp')
export class TotpController {
  constructor(private readonly totp: TotpService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('status')
  status(@CurrentUser() current: AuthenticatedRequestUser) {
    return this.totp.status(current.id, current.type);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('setup')
  setup(@CurrentUser() current: AuthenticatedRequestUser) {
    return this.totp.setup(current.id, current.type);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('enable')
  enable(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: EnableTotpDto,
  ) {
    return this.totp.enable(
      current.id,
      current.type,
      dto.secret,
      dto.code,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('disable')
  disable(
    @CurrentUser() current: AuthenticatedRequestUser,
    @Body() dto: DisableTotpDto,
  ) {
    return this.totp.disable(
      current.id,
      current.type,
      dto.password,
      dto.code,
    );
  }
}

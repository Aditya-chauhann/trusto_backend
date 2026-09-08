import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { StaffAuthService } from './staff-auth.service';
import { StaffLoginDto } from './dto/staff-login.dto';
import { ChangeStaffPasswordDto } from './dto/change-password.dto';
import { CaptchaGuard } from '../captcha/captcha.guard';
import { IpBlockService } from '../ip-block/ip-block.service';

import { IsNotEmpty, IsString } from 'class-validator';

class StaffForgotPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Email or username is required' })
  identifier: string;
}

@Controller('admin/auth')
export class StaffAuthController {
  constructor(
    private readonly staffAuth: StaffAuthService,
    private readonly ipBlockService: IpBlockService,
  ) {}

  @UseGuards(CaptchaGuard)
  @Post('login')
  login(@Req() req: Request, @Body() dto: StaffLoginDto) {
    const ip = this.ipBlockService.getClientIp(req);
    return this.staffAuth.login(dto, ip);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: StaffForgotPasswordDto) {
    return this.staffAuth.requestPasswordReset(dto.identifier);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('change-password')
  changePassword(
    @CurrentUser() principal: AuthenticatedRequestUser,
    @Body() dto: ChangeStaffPasswordDto,
  ) {
    if (principal.type !== 'staff') {
      throw new ForbiddenException('Only staff accounts can use this endpoint');
    }
    return this.staffAuth.changePassword(principal.id, dto);
  }
}

import { Body, Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LoginTotpDto } from '../two-factor/dto/login-totp.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';   ////added for forgot/reset password
import { ResetPasswordDto } from './dto/reset-password.dto';     ////added for forgot/reset password



import { CaptchaGuard } from '../captcha/captcha.guard';
import { IpBlockGuard } from '../ip-block/ip-block.guard';
import { IpBlockService } from '../ip-block/ip-block.service';

@UseGuards(IpBlockGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly ipBlockService: IpBlockService,
  ) {}

  @UseGuards(CaptchaGuard)
  @Post('register')
  register(@Req() req: Request, @Body() dto: RegisterDto) {
    const ip = this.ipBlockService.getClientIp(req);
    return this.authService.register(dto, ip);
  }
 //added for forgot/reset password
   @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
  //added for forgot/reset password

  @UseGuards(CaptchaGuard)
  @Post('login')
  login(@Req() req: Request, @Body() dto: LoginDto) {
    const ip = this.ipBlockService.getClientIp(req);
    return this.authService.login(dto, ip);
  }

  @Post('login/totp')
  loginTotp(@Body() dto: LoginTotpDto) {
    return this.authService.completeLoginWithTotp(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  me(@CurrentUser() user: unknown) {
    return user;
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('change-password')
  changePassword(
    @CurrentUser() user: { id: string },
    @Body() dto: { currentPassword?: string; newPassword?: string },
  ) {
    return this.authService.changeUserPassword(user.id, dto.currentPassword, dto.newPassword);
  }
}

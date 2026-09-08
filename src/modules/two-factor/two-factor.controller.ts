import { Body, Controller, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TwoFactorService } from './two-factor.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { TwoFactorPreferenceDto } from './dto/preference.dto';

@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('send')
  send(@CurrentUser() current: { id: string }, @Body() dto: SendOtpDto) {
    return this.twoFactor.sendCode(current.id, dto.channel, dto.phone, dto.email);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('verify')
  verify(@CurrentUser() current: { id: string }, @Body() dto: VerifyOtpDto) {
    return this.twoFactor.verifyCode(current.id, dto.otpId, dto.code);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('preference')
  setPreference(
    @CurrentUser() current: { id: string },
    @Body() dto: TwoFactorPreferenceDto,
  ) {
    return this.twoFactor.setPreference(current.id, dto.method);
  }
}

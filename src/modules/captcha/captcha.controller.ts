import { Controller, Get } from '@nestjs/common';
import { CaptchaService } from './captcha.service';

@Controller('captcha')
export class CaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  @Get('new')
  newCaptcha() {
    return this.captchaService.generate();
  }
}

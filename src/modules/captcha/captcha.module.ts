import { Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { CaptchaController } from './captcha.controller';
import { CaptchaGuard } from './captcha.guard';
import { IpBlockModule } from '../ip-block/ip-block.module';

@Module({
  imports: [IpBlockModule],
  controllers: [CaptchaController],
  providers: [CaptchaService, CaptchaGuard],
  exports: [CaptchaService, CaptchaGuard],
})
export class CaptchaModule {}

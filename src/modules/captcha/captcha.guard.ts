import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CaptchaService } from './captcha.service';
import { IpActivityService } from '../ip-activity/ip-activity.service';
import { IpBlockService } from '../ip-block/ip-block.service';

@Injectable()
export class CaptchaGuard implements CanActivate {
  constructor(
    private readonly captchaService: CaptchaService,
    private readonly ipBlockService: IpBlockService,
    private readonly ipActivityService: IpActivityService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const { captchaId, captchaAnswer, email, identifier } = (req.body ?? {}) as {
      captchaId?: string;
      captchaAnswer?: string;
      email?: string;
      identifier?: string;
    };
    try {
      this.captchaService.verify(captchaId, captchaAnswer);
    } catch (err) {
      const ip = this.ipBlockService.getClientIp(req);
      const targetIdentifier = (identifier || email || '').trim();
      void this.ipActivityService.recordFailedAttempt({
        identifier: targetIdentifier || undefined,
        actionType: 'wrong_captcha',
        ipAddress: ip,
        details: { captchaAnswer: captchaAnswer || '' },
      }).catch(() => {});
      throw err;
    }
    return true;
  }
}

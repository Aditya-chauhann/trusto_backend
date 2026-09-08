import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { DailyLogger } from '../../common/daily-logger';

/**
 * Verifies the `x-signature` header on the payout-bridge callback. The bridge
 * signs the exact JSON body with HMAC-SHA256 using the shared secret; we
 * recompute it over the RAW body and compare in constant time. Requires the app
 * to be created with `{ rawBody: true }` so `req.rawBody` is available.
 */
@Injectable()
export class PayoutBridgeSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('payoutBridge.callbackSecret');
    if (!secret) {
      throw new UnauthorizedException('Callback secret not configured');
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer }>();
    const provided = req.header('x-signature');
    const raw = req.rawBody;
    if (!provided || !raw) {
      throw new UnauthorizedException('Missing signature or body');
    }

    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      DailyLogger.security(`[SECURITY ALERT] Invalid callback signature attempt. IP: ${req.ip || req.headers['x-forwarded-for']}`, 'PayoutBridgeSignatureGuard');
      throw new UnauthorizedException('Invalid signature');
    }
    return true;
  }
}

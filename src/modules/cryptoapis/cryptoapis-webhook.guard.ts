import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Verifies the `x-signature` header on CryptoAPIs callbacks. CryptoAPIs signs
 * the exact JSON body with HMAC-SHA256 using the callbackSecretKey; we recompute
 * it over the RAW body and compare in constant time.
 */
@Injectable()
export class CryptoApisWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('cryptoApis.webhookSecret');
    if (!secret) {
      throw new UnauthorizedException('CryptoAPIs webhook secret not configured');
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
      throw new UnauthorizedException('Invalid signature');
    }
    return true;
  }
}

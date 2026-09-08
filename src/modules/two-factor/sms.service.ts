import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

interface LaafficSendResponse {
  status: string;
  reason?: string;
  success?: string;
  fail?: string;
  array?: Array<{ msgId: string; number: string; orderId?: string }>;
}

/**
 * SMS delivery via Laaffic (https://www.laaffic.com/).
 *
 * Laaffic is a plain SMS gateway: it only *sends* messages, it has no
 * managed OTP "verify/check" API like Twilio Verify did. The OTP code is
 * therefore generated, stored (hashed) and verified in TwoFactorService —
 * this class is only responsible for delivering the text.
 */
@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private readonly endpoint = 'https://api.laaffic.com/v3/sendSms';

  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private appId: string | null = null;
  private senderId: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.config.get<string>('LAAFFIC_API_KEY');
    const apiSecret = this.config.get<string>('LAAFFIC_API_SECRET');
    const appId = this.config.get<string>('LAAFFIC_APP_ID');
    const senderId = this.config.get<string>('LAAFFIC_SENDER_ID');

    if (!apiKey || !apiSecret || !appId) {
      this.logger.warn(
        'Laaffic not configured (need LAAFFIC_API_KEY, LAAFFIC_API_SECRET, LAAFFIC_APP_ID). SMS messages will be logged to the console instead.',
      );
      return;
    }

    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.appId = appId;
    this.senderId = senderId ?? null;
    this.logger.log(
      `Laaffic SMS ready (app=${appId}, key=${apiKey.slice(0, 6)}...)`,
    );
    if (!senderId) {
      this.logger.warn(
        'LAAFFIC_SENDER_ID not set. Messages will be sent without a custom sender id.',
      );
    }
  }

  private get configured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.appId);
  }

  /** Laaffic expects the number with country code but WITHOUT a leading '+'. */
  private toLaafficNumber(toE164: string): string {
    return toE164.replace(/^\+/, '');
  }

  /**
   * Low-level send. Auth per Laaffic docs:
   *   Sign      = md5(apiKey + apiSecret + timestamp)
   *   Timestamp = current unix epoch seconds
   *   Api-Key   = apiKey
   * A successful response has status === '0'.
   */
  private async send(toE164: string, content: string): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign = createHash('md5')
      .update(`${this.apiKey}${this.apiSecret}${timestamp}`)
      .digest('hex');

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        Sign: sign,
        Timestamp: timestamp,
        'Api-Key': this.apiKey as string,
      },
      body: JSON.stringify({
        appId: this.appId,
        numbers: this.toLaafficNumber(toE164),
        content,
        ...(this.senderId ? { senderId: this.senderId } : {}),
      }),
    });

    const data = (await res
      .json()
      .catch(() => null)) as LaafficSendResponse | null;

    if (!res.ok || !data || data.status !== '0') {
      const reason = data?.reason ?? `HTTP ${res.status}`;
      throw new Error(
        `Laaffic send failed (status=${data?.status ?? 'n/a'}): ${reason}`,
      );
    }

    const msgId = data.array?.[0]?.msgId;
    this.logger.log(`Laaffic SMS sent: msgId=${msgId ?? 'n/a'} to=${toE164}`);
  }

  /**
   * Deliver an OTP code by SMS. Unlike Twilio Verify, the code is generated
   * by the caller (TwoFactorService) and passed in here for delivery only.
   */
  async sendOtpSms(toE164: string, code: string): Promise<void> {
    const content = `Your TrustO verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`;

    if (!this.configured) {
      this.logger.log(
        `[DEV-SMS] Would send OTP ${code} to ${toE164} via Laaffic.`,
      );
      return;
    }

    try {
      await this.send(toE164, content);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Laaffic OTP send failed for ${toE164}: ${message}`);
      throw new ServiceUnavailableException({
        statusCode: 503,
        errorCode: 'SMS_PROVIDER_FAILED',
        message:
          'Could not send SMS code. Please try again in a moment or use email instead.',
        ...(process.env.NODE_ENV !== 'production'
          ? { providerMessage: message }
          : {}),
      });
    }
  }

  async sendNotificationSms(toE164: string, body: string): Promise<void> {
    if (!this.configured) {
      this.logger.log(`[DEV-SMS] Notification to ${toE164}: ${body}`);
      return;
    }
    try {
      await this.send(toE164, body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Laaffic notification SMS failed for ${toE164}: ${message}`,
      );
      throw err;
    }
  }
}

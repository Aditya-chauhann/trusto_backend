import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { otpCodeEmail } from './mail-templates/otpCode';
import { passwordResetCodeEmail } from './mail-templates/passwordResetCode';
import { tempPasswordEmail } from './mail-templates/tempPassword';

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;
  private from = 'TrustO <no-reply@tronpay.local>';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER');
    const rawPass = this.config.get<string>('SMTP_PASS');
    const rawFrom = this.config.get<string>('SMTP_FROM');

    if (!host || !user || !rawPass) {
      this.logger.warn(
        'SMTP not configured (need SMTP_HOST, SMTP_USER, SMTP_PASS). Falling back to console logger.',
      );
      return;
    }

    const pass = rawPass.replace(/[\s-]/g, '');
    const from =
      rawFrom && /<[^@\s>]+@[^@\s>]+>/.test(rawFrom)
        ? rawFrom
        : `TrustO <${user}>`;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    this.from = from;
    this.transporter
      .verify()
      .then(() =>
        this.logger.log(
          `SMTP mailer ready (host=${host}:${port}, from=${this.from})`,
        ),
      )
      .catch((err: unknown) =>
        this.logger.error(
          `SMTP verify failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  async sendPinResetEmail(to: string, code: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `[DEV-MAILER] Admin PIN reset code for ${to}: ${code} (valid 10 min)`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Reset your TronPay admin login PIN',
        text: `Your TronPay admin PIN reset code is ${code}. It expires in 10 minutes. If you didn't request this, someone may be trying to access the admin console — change your password immediately.`,
        html: `
          <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 12px">Reset your admin login PIN</h2>
            <p style="margin:0 0 16px;color:#334155">Use this code to set a new 6-digit login PIN:</p>
            <div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#f1f5f9;border-radius:8px;padding:16px;text-align:center">${code}</div>
            <p style="margin:16px 0 0;font-size:13px;color:#64748b">The code expires in 10 minutes. If you didn't request this, someone may be trying to access the admin console — change your password immediately.</p>
          </div>
        `,
      });
      this.logger.log(`Admin PIN reset email sent to ${to}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send PIN reset email to ${to}: ${message}`);
      throw new ServiceUnavailableException({
        statusCode: 503,
        errorCode: 'EMAIL_PROVIDER_FAILED',
        message: 'Could not send the reset code. Please try again in a moment.',
        ...(process.env.NODE_ENV !== 'production'
          ? { providerMessage: message }
          : {}),
      });
    }
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[DEV-MAILER] OTP for ${to}: ${code} (valid 10 min)`);
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Your TrustO verification code',
        text: `Your TrustO verification code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
        html: otpCodeEmail({ code, expiryMinutes: 10 }),
      });
      this.logger.log(
        `OTP email sent to ${to} (messageId=${(info as { messageId?: string }).messageId ?? 'n/a'})`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send OTP email to ${to}: ${message}`);
      throw new ServiceUnavailableException({
        statusCode: 503,
        errorCode: 'EMAIL_PROVIDER_FAILED',
        message:
          'Could not send email code. Please try again in a moment or use SMS instead.',
        ...(process.env.NODE_ENV !== 'production'
          ? { providerMessage: message }
          : {}),
      });
    }
  }

  //for forget/reset mail
  async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[DEV-MAILER] Password reset code for ${to}: ${code} (valid 10 min)`);
      return;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Reset your TrustO password',
        text: `Your TrustO password reset code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
        html: passwordResetCodeEmail({ code, expiryMinutes: 10 }),
      });
      this.logger.log(
        `Password reset email sent to ${to} (messageId=${(info as { messageId?: string }).messageId ?? 'n/a'})`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send password reset email to ${to}: ${message}`);
      throw new ServiceUnavailableException({
        statusCode: 503,
        errorCode: 'EMAIL_PROVIDER_FAILED',
        message: 'Could not send reset email. Please try again in a moment.',
        ...(process.env.NODE_ENV !== 'production' ? { providerMessage: message } : {}),
      });
    }
  }
  //for forget/reset mail

  async sendNotificationEmail(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[DEV-MAILER] Notification to ${to} — ${subject}: ${text}`);
      return;
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        text,
        ...(html ? { html } : {}),
      });
      this.logger.log(
        `Notification email sent to ${to} (messageId=${(info as { messageId?: string }).messageId ?? 'n/a'})`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to send notification email to ${to}: ${message}`,
      );
      throw err;
    }
  }

  async sendTemporaryPasswordEmail(
    to: string,
    tempPass: string,
    staffName: string,
  ): Promise<void> {
    const subject = 'Your TrustO Password Reset Request Approved';
    const text = `Hello ${staffName},\n\nYour password reset request has been approved by the Administrator.\nYour temporary password is: ${tempPass}\n\nPlease sign in to your staff portal and set a new password on first login.\n\nRegards,\nTrustO Support Team`;
    const html = tempPasswordEmail({ tempPass, staffName });
    return this.sendNotificationEmail(to, subject, text, html);
  }
}
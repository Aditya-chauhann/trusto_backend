/**
 * mail-templates/otpCode.ts
 * Content for MailerService.sendOtpEmail() — the OTP challenge email
 * (login 2FA and any other code-based verification via email channel).
 */
import { renderLayout, codeBox, BRAND } from './layout';

export interface OtpCodeEmailData {
  code: string;
  expiryMinutes?: number;
}

export function otpCodeEmail({ code, expiryMinutes = 10 }: OtpCodeEmailData): string {
 

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;color:${BRAND.textPrimary};">
      Your verification code
    </h1>
    <p style="margin:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${BRAND.textMuted};">
      Use this code to continue. It expires in ${expiryMinutes} minutes.
    </p>
    ${codeBox(code)}
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${BRAND.footerText};">
      If you didn't request this, you can safely ignore this email.
    </p>
  `;

  return renderLayout({
    preheader: `${code} is your ${BRAND.name} verification code`,
    bodyHtml,
  });
}

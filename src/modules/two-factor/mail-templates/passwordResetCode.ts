/**
 * mail-templates/passwordResetCode.ts
 * Content for MailerService.sendPasswordResetEmail() — a reset *code*
 * (the current backend method sends a code, not a link).
 */
import { renderLayout, codeBox, BRAND } from './layout';

export interface PasswordResetCodeEmailData {
  code: string;
  expiryMinutes?: number;
}

export function passwordResetCodeEmail({
  code,
  expiryMinutes = 10,
}: PasswordResetCodeEmailData): string {
  

  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;color:${BRAND.textPrimary};">
      Reset your password
    </h1>
    <p style="margin:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${BRAND.textMuted};">
      Use this code to reset your ${BRAND.name} password. It expires in ${expiryMinutes} minutes.
    </p>
    ${codeBox(code)}
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${BRAND.footerText};">
      If you didn't request this, you can safely ignore this email — your password won't change.
    </p>
  `;

  return renderLayout({
    preheader: `Reset your ${BRAND.name} password`,
    bodyHtml,
  });
}

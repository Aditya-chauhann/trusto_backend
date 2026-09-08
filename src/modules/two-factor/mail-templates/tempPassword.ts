/**
 * mail-templates/tempPassword.ts
 * Content for MailerService.sendTemporaryPasswordEmail() — notifies a
 * staff/agent account of an admin-issued temporary password.
 */
import { renderLayout, BRAND } from './layout';

export interface TempPasswordEmailData {
  tempPass: string;
  staffName: string;
}

export function tempPasswordEmail({ tempPass, staffName }: TempPasswordEmailData): string {
  const bodyHtml = `
    <h1 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;color:${BRAND.textPrimary};">
      Temporary password issued
    </h1>
    <p style="margin:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${BRAND.textMuted};">
      Hello ${staffName}, your request to reset your password has been approved by the administrator. You'll be asked to set a new password on your next sign-in.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;">
      <tr>
        <td align="center" style="background-color:${BRAND.codeBoxBg};border:1px solid ${BRAND.codeBoxBorder};border-radius:8px;padding:16px 0;">
          <span style="font-family:'Courier New',monospace;font-size:22px;font-weight:bold;letter-spacing:2px;color:${BRAND.accent};">
            ${tempPass}
          </span>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${BRAND.footerText};">
      For security, this password should be changed immediately after signing in.
    </p>
  `;

  return renderLayout({
    preheader: `A temporary password was issued for your ${BRAND.name} account`,
    bodyHtml,
  });
}

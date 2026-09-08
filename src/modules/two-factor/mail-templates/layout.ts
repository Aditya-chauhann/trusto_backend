export const BRAND = {
  name: 'TrustO',
  tagline: 'USDT TO INR · INSTANT OFF-RAMP',
  accent: '#0d9488',
  headerBg: '#0d2438',
  pageBg: '#f4f5f7',
  cardBg: '#ffffff',
  cardBorder: '#e5e7eb',
  textPrimary: '#0f172a',
  textMuted: '#64748b',
  footerText: '#94a3b8',
  codeBoxBg: '#ecfdf9',
  codeBoxBorder: '#99e6da',
  // Served from the frontend's public/ folder
  logoUrl: process.env.MAIL_LOGO_URL || 'https://trusto.exchange/favicon.png',
  supportEmail: process.env.MAIL_SUPPORT_EMAIL || 'support@trusto.exchange',
};

export interface RenderLayoutOptions {
  preheader?: string;
  bodyHtml: string;
  footerNote?: string;
}

export function renderLayout({
  preheader = '',
  bodyHtml,
  footerNote = '',
}: RenderLayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${BRAND.name}</title>
  <!--[if mso]>
  <style>
    * { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BRAND.pageBg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    ${preheader}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.pageBg};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:${BRAND.cardBg};border:1px solid ${BRAND.cardBorder};border-radius:14px;overflow:hidden;">

          <!-- Header band: logo + wordmark + tagline -->
          <tr>
            <td style="background-color:${BRAND.headerBg};padding:18px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:8px;vertical-align:middle;">
                    <img src="${BRAND.logoUrl}" width="40" height="40" alt="${BRAND.name}" style="display:block;object-fit:contain;" />
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:bold;color:#ffffff;line-height:1.2;">
                      ${BRAND.name}
                    </div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;color:#8fa5b8;margin-top:3px;">
                      ${BRAND.tagline}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card body -->
          <tr>
            <td style="padding:32px 28px;">
              ${bodyHtml}
            </td>
          </tr>

        </table>

        <!-- Footer (outside the card) -->
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <tr>
            <td style="padding:20px 28px 0;" align="left">
              <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${BRAND.footerText};">
                ${footerNote ? footerNote + '<br/>' : ''}
                This is an automated message from ${BRAND.name}. Need help? Contact
                <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.accent};text-decoration:none;">${BRAND.supportEmail}</a>.
              </p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.footerText};">
                &copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Shared "code in a box" block used by every OTP-style email. */
export function codeBox(code: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;">
      <tr>
        <td align="center" style="background-color:${BRAND.codeBoxBg};border:1px solid ${BRAND.codeBoxBorder};border-radius:8px;padding:16px 0;">
          <span style="font-family:'Courier New',monospace;font-size:26px;font-weight:bold;letter-spacing:8px;color:${BRAND.accent};">
            ${code}
          </span>
        </td>
      </tr>
    </table>`;
}
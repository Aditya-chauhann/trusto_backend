import { randomInt, randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';

interface CaptchaEntry {
  text: string;
  expiresAt: number;
}

const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CAPTCHA_LENGTH = 5;
const CAPTCHA_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class CaptchaService {
  // in-memory, per-process — same pattern as LoginRateLimitService.
  private readonly store = new Map<string, CaptchaEntry>();

  generate(): { captchaId: string; svg: string } {
    this.cleanupExpired();
    const text = this.randomText();
    const captchaId = randomUUID();
    this.store.set(captchaId, { text, expiresAt: Date.now() + CAPTCHA_TTL_MS });
    return { captchaId, svg: this.renderSvg(text) };
  }

  /**
   * Verifies and consumes (single-use) a captcha answer. Always deletes the
   * entry first so it can never be replayed — whether this call succeeds or
   * fails. Throws the same generic error for every failure reason (missing,
   * expired, wrong) so a caller can't tell which part was wrong.
   */
  verify(captchaId: string | undefined, answer: string | undefined): void {
    const fail = () =>
      new BadRequestException({
        statusCode: 400,
        errorCode: 'CAPTCHA_INVALID',
        message: 'Incorrect captcha. Please try again.',
      });

    if (!captchaId || !answer) throw fail();

    const entry = this.store.get(captchaId);
    this.store.delete(captchaId);

    if (!entry) throw fail();
    if (Date.now() > entry.expiresAt) throw fail();
    if (answer.trim().toLowerCase() !== entry.text) throw fail();
  }

  private randomText(): string {
    let text = '';
    for (let i = 0; i < CAPTCHA_LENGTH; i++) {
      text += CHARSET[randomInt(CHARSET.length)];
    }
    return text;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, entry] of this.store) {
      if (entry.expiresAt < now) this.store.delete(id);
    }
  }

  private renderSvg(text: string): string {
    const width = 150;
    const height = 50;

    const noiseLines = Array.from({ length: 4 }, () => {
      const x1 = randomInt(width);
      const y1 = randomInt(height);
      const x2 = randomInt(width);
      const y2 = randomInt(height);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" stroke-width="1" opacity="0.5" />`;
    }).join('');

    const charWidth = width / (text.length + 1);
    const glyphs = text
      .split('')
      .map((char, i) => {
        const x = charWidth * (i + 1);
        const y = height / 2 + randomInt(10) - 5;
        const rotate = randomInt(30) - 15;
        const fontSize = 26 + randomInt(6);
        const color = `hsl(${randomInt(360)}, 60%, 35%)`;
        return `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="monospace" font-weight="bold" fill="${color}" text-anchor="middle" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
      })
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f1f5f9" />${noiseLines}${glyphs}</svg>`;
  }
}

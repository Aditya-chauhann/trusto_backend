import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export class DailyLogger {
  private static logDir = path.join(process.cwd(), 'logs');
  private static logger = new Logger('DailyProcess');

  private static ensureDirExists() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error('DailyLogger failed to create logs directory:', err);
    }
  }

  static log(message: string, context?: string) {
    this.logger.log(message, context);
    this.writeToFile('INFO', message, context);
  }

  static warn(message: string, context?: string) {
    this.logger.warn(message, context);
    this.writeToFile('WARN', message, context);
  }

  static error(message: string, trace?: string, context?: string) {
    this.logger.error(message, trace, context);
    this.writeToFile('ERROR', message, context, trace);
    this.sendTelegramAlert('ERROR', message, context, trace);
  }

  static security(message: string, context?: string) {
    this.logger.warn(`[SECURITY] ${message}`, context);
    this.writeToFile('SECURITY', message, context);
    this.sendTelegramAlert('SECURITY', message, context);
  }

  private static writeToFile(level: string, message: string, context?: string, trace?: string) {
    try {
      this.ensureDirExists();
      const today = new Date();
      const dateString = today.toISOString().split('T')[0];
      const logFile = path.join(this.logDir, `${dateString}.log`);

      const timestamp = today.toISOString();
      const contextStr = context ? ` [${context}]` : '';
      const traceStr = trace ? `\nStack: ${trace}` : '';

      const logLine = `[${timestamp}] [${level}]${contextStr} ${message}${traceStr}\n`;
      fs.appendFileSync(logFile, logLine, 'utf8');
    } catch (err) {
      console.error('DailyLogger failed to write entry to file:', err);
    }
  }

  private static escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private static async sendTelegramAlert(level: string, message: string, context?: string, trace?: string) {
    const token = process.env.TELEGRAM_ALERT_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;

    if (!token || !chatId) {
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const contextStr = context ? `<b>${this.escapeHtml(context)}</b>` : '<code>System</code>';
      const levelIcon = level === 'ERROR' ? '🚨' : '🔒';
      const traceStr = trace ? `\n\n<b>Stack Trace:</b>\n<code>${this.escapeHtml(trace.substring(0, 800))}</code>` : '';

      const text =
        `${levelIcon} <b>System Alert — ${level}</b>\n` +
        `<b>Time:</b> <code>${timestamp}</code>\n` +
        `<b>Module:</b> ${contextStr}\n\n` +
        `<b>Details:</b>\n${this.escapeHtml(message)}` +
        traceStr;

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
        }),
      });
    } catch (err) {
      console.error('DailyLogger failed to send Telegram alert:', err);
    }
  }
}

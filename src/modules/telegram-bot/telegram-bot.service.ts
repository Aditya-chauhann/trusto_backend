import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Deposit, DepositDocument } from '../deposits/schemas/deposit.schema';
import {
  Withdrawal,
  WithdrawalDocument,
  WithdrawalStatus,
} from '../withdrawals/schemas/withdrawal.schema';
import {
  WithdrawalDispute,
  WithdrawalDisputeDocument,
} from '../withdrawal-disputes/schemas/withdrawal-dispute.schema';
import {
  Ticket,
  TicketDocument,
  TicketResolutionStatus,
} from '../tickets/schemas/ticket.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  PricingSettings,
  PricingSettingsDocument,
} from '../pricing/schemas/pricing-settings.schema';
import { DailyLogger } from '../../common/daily-logger';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

interface CalendarSession {
  step: 'from' | 'to';
  viewYear: number;
  viewMonth: number; // 0-11
  tentativeDay: number | null;
  fromYear?: number;
  fromMonth?: number;
  fromDay?: number;
  messageId?: number;
  updatedAt: number;
}

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private isRunning = false;
  private botStartTime = 0;
  private abortController = new AbortController();
  private summaryInterval: NodeJS.Timeout | null = null;
  private knownChatIds = new Set<string>();

  // In-memory state tracking for users/chats awaiting custom date range inputs
  private awaitingCustomDate = new Map<
    string,
    { messageId: number; timestamp: number }
  >();

  // In-memory state tracking for interactive calendar date range picker
  private calendarSessions = new Map<string, CalendarSession>();

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Deposit.name)
    private readonly depositModel: Model<DepositDocument>,
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    @InjectModel(WithdrawalDispute.name)
    private readonly disputeModel: Model<WithdrawalDisputeDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(PricingSettings.name)
    private readonly pricingSettingsModel: Model<PricingSettingsDocument>,
  ) {}

  onModuleInit() {
    const alertBotToken =
      process.env.TELEGRAM_ALERT_BOT_TOKEN?.trim() ||
      this.config.get<string>('telegramAlertBotToken')?.trim() ||
      null;

    const transactionBotToken =
      process.env.TELEGRAM_TRANSACTION_BOT_TOKEN?.trim() ||
      this.config.get<string>('telegramTransactionBotToken')?.trim() ||
      null;

    const bots = [
      { name: 'AlertBot', token: alertBotToken },
      { name: 'TransactionBot', token: transactionBotToken },
    ].filter((b): b is { name: string; token: string } => !!b.token);

    if (bots.length === 0) {
      this.logger.warn(
        'No Telegram bot tokens configured — Telegram command listener disabled',
      );
      return;
    }

    this.isRunning = true;
    this.botStartTime = Math.floor(Date.now() / 1000) - 15;

    for (const bot of bots) {
      this.logger.log(`Starting Telegram listener for ${bot.name}...`);
      void this.startPolling(bot.name, bot.token);
    }

    // Periodic Deposit & Withdraw notification timer
    const durationRaw =
      process.env.DEPOSIT_WITHDRAW_NOTIFICATION_DURATION?.trim() ||
      process.env['deposit-withdraw notification duration']?.trim() ||
      this.config.get<string>('depositWithdrawNotificationDuration')?.trim() ||
      '15m';

    const durationMs = this.parseDurationMs(durationRaw);
    if (durationMs > 0 && transactionBotToken) {
      this.logger.log(
        `Starting periodic Deposit & Withdraw summary (every ${durationMs / 60000}m [env: ${durationRaw}])...`,
      );
      this.summaryInterval = setInterval(() => {
        void this.dispatchPeriodicSummary();
      }, durationMs);
    }
  }

  onModuleDestroy() {
    this.isRunning = false;
    this.abortController.abort();
    if (this.summaryInterval) {
      clearInterval(this.summaryInterval);
      this.summaryInterval = null;
    }
  }

  private async startPolling(botName: string, token: string) {
    let offset = 0;
    while (this.isRunning) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`;
        const res = await fetch(url, {
          signal: this.abortController.signal,
        });

        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        const data = (await res.json()) as {
          ok: boolean;
          result: Array<{
            update_id: number;
            message?: {
              message_id: number;
              date: number;
              chat: { id: number | string; title?: string; type: string };
              from?: { id: number; username?: string; first_name?: string };
              text?: string;
              reply_to_message?: { message_id: number; from?: { is_bot?: boolean } };
            };
            callback_query?: {
              id: string;
              from: { id: number; username?: string; first_name?: string };
              message?: {
                message_id: number;
                chat: { id: number | string; title?: string; type: string };
                date?: number;
              };
              data?: string;
            };
          }>;
        };

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            offset = update.update_id + 1;
            if (update.message) {
              await this.handleMessage(update.message, token, botName);
            } else if (update.callback_query) {
              await this.handleCallbackQuery(update.callback_query, token, botName);
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || !this.isRunning) {
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private getReportMenuKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '⏱ 24 Hours', callback_data: 'rep_24h' },
          { text: '📅 1 Day (Today)', callback_data: 'rep_1d' },
        ],
        [
          { text: '📊 3 Days', callback_data: 'rep_3d' },
          { text: '📈 7 Days', callback_data: 'rep_7d' },
        ],
        [
          { text: '🗓 1 Month', callback_data: 'rep_1m' },
          { text: '📆 1 Year', callback_data: 'rep_1y' },
        ],
        [{ text: '✏️ Custom Range', callback_data: 'rep_custom' }],
      ],
    };
  }

  private getReportBackKeyboard() {
    return {
      inline_keyboard: [
        [{ text: '🔄 Change Period / New Report', callback_data: 'rep_menu' }],
      ],
    };
  }

  private getCustomRangeKeyboard() {
    return {
      inline_keyboard: [
        [{ text: '« Back to Presets', callback_data: 'rep_menu' }],
      ],
    };
  }

  private getCalendarMessageText(session: CalendarSession): string {
    const monthName = MONTH_NAMES[session.viewMonth];
    if (session.step === 'from') {
      let dateLine = '';
      if (session.tentativeDay) {
        dateLine = `\n📌 Selected: <b>${session.tentativeDay} ${monthName} ${session.viewYear}</b>\n`;
      }
      return (
        `📅 <b>Select your From date</b>\n` +
        dateLine +
        `\n<i>Tap a day on the calendar below, then tap Confirm.</i>`
      );
    } else {
      const fromMonthName = MONTH_NAMES[session.fromMonth!];
      const fromFormatted = `${session.fromDay} ${fromMonthName} ${session.fromYear}`;
      let toLine = '';
      if (session.tentativeDay) {
        toLine = `• <b>To:</b> <b>${session.tentativeDay} ${monthName} ${session.viewYear}</b>\n`;
      }
      return (
        `📅 <b>Select your To date</b>\n\n` +
        `• <b>From:</b> <code>${fromFormatted}</code>\n` +
        toLine +
        `\n<i>Tap a day on the calendar below, then tap Confirm.</i>`
      );
    }
  }

  private buildCalendarKeyboard(session: CalendarSession) {
    const { viewYear, viewMonth, tentativeDay } = session;
    const monthName = MONTH_NAMES[viewMonth];
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

    // Header row: ◀️ Prev | Month Year | Next ▶️
    keyboard.push([
      { text: '◀️ Prev', callback_data: 'cal:prev' },
      { text: `${monthName} ${viewYear}`, callback_data: 'cal:noop' },
      { text: 'Next ▶️', callback_data: 'cal:next' },
    ]);

    // Weekday labels: Su Mo Tu We Th Fr Sa
    keyboard.push([
      { text: 'Su', callback_data: 'cal:noop' },
      { text: 'Mo', callback_data: 'cal:noop' },
      { text: 'Tu', callback_data: 'cal:noop' },
      { text: 'We', callback_data: 'cal:noop' },
      { text: 'Th', callback_data: 'cal:noop' },
      { text: 'Fr', callback_data: 'cal:noop' },
      { text: 'Sa', callback_data: 'cal:noop' },
    ]);

    // Days grid (7 columns)
    let currentDay = 1;
    while (currentDay <= daysInMonth) {
      const row: Array<{ text: string; callback_data: string }> = [];
      for (let col = 0; col < 7; col++) {
        if (keyboard.length === 2 && col < firstWeekday) {
          // Left padding before day 1
          row.push({ text: ' ', callback_data: 'cal:noop' });
        } else if (currentDay > daysInMonth) {
          // Right padding after last day of month
          row.push({ text: ' ', callback_data: 'cal:noop' });
        } else {
          const isSelected = currentDay === tentativeDay;
          const text = isSelected ? `✅ ${currentDay}` : `${currentDay}`;
          row.push({
            text,
            callback_data: `cal:day:${currentDay}`,
          });
          currentDay++;
        }
      }
      keyboard.push(row);
    }

    // Confirm button row
    const confirmLabel = tentativeDay
      ? `✅ Confirm (${tentativeDay} ${MONTH_SHORT[viewMonth]})`
      : `✅ Confirm`;
    keyboard.push([{ text: confirmLabel, callback_data: 'cal:confirm' }]);

    // Cancel button row
    keyboard.push([{ text: '❌ Cancel', callback_data: 'cal:cancel' }]);

    return { inline_keyboard: keyboard };
  }

  private getDateRangeForPreset(
    preset: string,
  ): { start: Date; end: Date; label: string } | null {
    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffsetMs);
    const startOfTodayIst = new Date(
      Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth(),
        istNow.getUTCDate(),
        0,
        0,
        0,
        0,
      ) - istOffsetMs,
    );

    const normalized = preset.trim().toLowerCase();
    switch (normalized) {
      case '24h':
      case '24 hours':
      case '24hours':
      case '24_hours':
        return {
          start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          end: now,
          label: 'Last 24 Hours',
        };
      case '1d':
      case '1 day':
      case '1day':
      case 'today':
        return {
          start: startOfTodayIst,
          end: now,
          label: 'Today (1 Day)',
        };
      case '3d':
      case '3 days':
      case '3days':
        return {
          start: new Date(startOfTodayIst.getTime() - 2 * 24 * 60 * 60 * 1000),
          end: now,
          label: 'Last 3 Days',
        };
      case '7d':
      case '7 days':
      case '7days':
      case 'week':
      case '1 week':
        return {
          start: new Date(startOfTodayIst.getTime() - 6 * 24 * 60 * 60 * 1000),
          end: now,
          label: 'Last 7 Days',
        };
      case '1m':
      case '1 month':
      case '1month':
      case 'month':
      case '30d':
      case '30 days':
        return {
          start: new Date(startOfTodayIst.getTime() - 29 * 24 * 60 * 60 * 1000),
          end: now,
          label: 'Last 1 Month (30 Days)',
        };
      case '1y':
      case '1 year':
      case '1year':
      case 'year':
      case '365d':
        return {
          start: new Date(
            startOfTodayIst.getTime() - 364 * 24 * 60 * 60 * 1000,
          ),
          end: now,
          label: 'Last 1 Year (365 Days)',
        };
      default:
        return null;
    }
  }

  private parseDateRange(
    text: string,
  ): { start: Date; end: Date; label: string } | null {
    if (!text) return null;
    const match = text.match(
      /(?:from\s+)?(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\s*(?:to|-|—)\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/i,
    );
    if (!match) return null;

    let d1 = parseInt(match[1], 10);
    let m1 = parseInt(match[2], 10);
    let y1 = parseInt(match[3], 10);
    let d2 = parseInt(match[4], 10);
    let m2 = parseInt(match[5], 10);
    let y2 = parseInt(match[6], 10);

    if (y1 < 100) y1 += 2000;
    if (y2 < 100) y2 += 2000;

    if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12) return null;
    if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;

    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    let start = new Date(Date.UTC(y1, m1 - 1, d1, 0, 0, 0, 0) - istOffsetMs);
    let end = new Date(Date.UTC(y2, m2 - 1, d2, 23, 59, 59, 999) - istOffsetMs);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

    if (start.getTime() > end.getTime()) {
      const tmp = start;
      start = end;
      end = tmp;
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    const label = `Custom Range (${pad(d1)}-${pad(m1)}-${y1} to ${pad(d2)}-${pad(m2)}-${y2})`;

    return { start, end, label };
  }

  private async handleCallbackQuery(
    cb: {
      id: string;
      from: { id: number; username?: string; first_name?: string };
      message?: {
        message_id: number;
        chat: { id: number | string; title?: string; type: string };
      };
      data?: string;
    },
    token: string,
    botName: string,
  ) {
    if (!cb.message || !cb.data) {
      await this.answerCallbackQuery(token, cb.id);
      return;
    }

    const chatId = cb.message.chat.id;
    const messageId = cb.message.message_id;
    const userId = cb.from.id;
    const data = cb.data;

    this.logger.log(
      `[${botName}] Received callback ${data} from @${cb.from.username || userId} in chat=${chatId}`,
    );

    if (data === 'rep_menu') {
      await this.answerCallbackQuery(token, cb.id);
      const menuText =
        `📊 <b>TrustO Performance Report</b>\n\n` +
        `Please select a time period for the report:`;
      await this.editMessage(
        token,
        chatId,
        messageId,
        menuText,
        this.getReportMenuKeyboard(),
      );
      return;
    }

    if (data === 'rep_custom') {
      await this.answerCallbackQuery(token, cb.id);

      const now = new Date();
      const istOffsetMs = 5.5 * 60 * 60 * 1000;
      const istNow = new Date(now.getTime() + istOffsetMs);
      const currentYear = istNow.getUTCFullYear();
      const currentMonth = istNow.getUTCMonth();

      // Clean up states older than 15 minutes
      const nowTs = Date.now();
      for (const [k, v] of this.calendarSessions.entries()) {
        if (nowTs - v.updatedAt > 15 * 60 * 1000) {
          this.calendarSessions.delete(k);
        }
      }

      const session: CalendarSession = {
        step: 'from',
        viewYear: currentYear,
        viewMonth: currentMonth,
        tentativeDay: null,
        messageId,
        updatedAt: nowTs,
      };

      this.calendarSessions.set(`${chatId}:${userId}`, session);
      this.calendarSessions.set(`${chatId}`, session);

      await this.editMessage(
        token,
        chatId,
        messageId,
        this.getCalendarMessageText(session),
        this.buildCalendarKeyboard(session),
      );
      return;
    }

    if (data.startsWith('cal:')) {
      if (data === 'cal:noop') {
        await this.answerCallbackQuery(token, cb.id);
        return;
      }

      if (data === 'cal:cancel') {
        this.calendarSessions.delete(`${chatId}:${userId}`);
        this.calendarSessions.delete(`${chatId}`);
        await this.answerCallbackQuery(token, cb.id, 'Cancelled');
        const menuText =
          `📊 <b>TrustO Performance Report</b>\n\n` +
          `Please select a time period for the report:`;
        await this.editMessage(
          token,
          chatId,
          messageId,
          menuText,
          this.getReportMenuKeyboard(),
        );
        return;
      }

      const session =
        this.calendarSessions.get(`${chatId}:${userId}`) ||
        this.calendarSessions.get(`${chatId}`);

      if (!session) {
        await this.answerCallbackQuery(
          token,
          cb.id,
          'Session expired. Please select /report again.',
          true,
        );
        return;
      }

      session.updatedAt = Date.now();

      if (data === 'cal:prev') {
        session.viewMonth--;
        if (session.viewMonth < 0) {
          session.viewMonth = 11;
          session.viewYear--;
        }
        session.tentativeDay = null;
        await this.answerCallbackQuery(token, cb.id);
        await this.editMessage(
          token,
          chatId,
          messageId,
          this.getCalendarMessageText(session),
          this.buildCalendarKeyboard(session),
        );
        return;
      }

      if (data === 'cal:next') {
        session.viewMonth++;
        if (session.viewMonth > 11) {
          session.viewMonth = 0;
          session.viewYear++;
        }
        session.tentativeDay = null;
        await this.answerCallbackQuery(token, cb.id);
        await this.editMessage(
          token,
          chatId,
          messageId,
          this.getCalendarMessageText(session),
          this.buildCalendarKeyboard(session),
        );
        return;
      }

      if (data.startsWith('cal:day:')) {
        const dayNum = parseInt(data.replace('cal:day:', ''), 10);
        if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
          session.tentativeDay = dayNum;
          await this.answerCallbackQuery(token, cb.id);
          await this.editMessage(
            token,
            chatId,
            messageId,
            this.getCalendarMessageText(session),
            this.buildCalendarKeyboard(session),
          );
        }
        return;
      }

      if (data === 'cal:confirm') {
        if (!session.tentativeDay) {
          await this.answerCallbackQuery(
            token,
            cb.id,
            session.step === 'from'
              ? '⚠️ Please select a From day first!'
              : '⚠️ Please select a To day first!',
            true,
          );
          return;
        }

        if (session.step === 'from') {
          session.fromYear = session.viewYear;
          session.fromMonth = session.viewMonth;
          session.fromDay = session.tentativeDay;
          session.step = 'to';
          session.tentativeDay = null;

          await this.answerCallbackQuery(
            token,
            cb.id,
            `From date set: ${session.fromDay} ${MONTH_SHORT[session.fromMonth]}`,
          );
          await this.editMessage(
            token,
            chatId,
            messageId,
            this.getCalendarMessageText(session),
            this.buildCalendarKeyboard(session),
          );
          return;
        }

        if (session.step === 'to') {
          const toYear = session.viewYear;
          const toMonth = session.viewMonth;
          const toDay = session.tentativeDay;

          const istOffsetMs = 5.5 * 60 * 60 * 1000;
          let start = new Date(
            Date.UTC(
              session.fromYear!,
              session.fromMonth!,
              session.fromDay!,
              0,
              0,
              0,
              0,
            ) - istOffsetMs,
          );
          let end = new Date(
            Date.UTC(toYear, toMonth, toDay, 23, 59, 59, 999) - istOffsetMs,
          );

          let fromD = session.fromDay!;
          let fromM = session.fromMonth! + 1;
          let fromY = session.fromYear!;
          let toD = toDay;
          let toM = toMonth + 1;
          let toY = toYear;

          if (start.getTime() > end.getTime()) {
            const tmp = start;
            start = end;
            end = tmp;
            fromD = toDay;
            fromM = toMonth + 1;
            fromY = toYear;
            toD = session.fromDay!;
            toM = session.fromMonth! + 1;
            toY = session.fromYear!;
          }

          const pad = (n: number) => String(n).padStart(2, '0');
          const label = `Custom Range (${pad(fromD)}-${pad(fromM)}-${fromY} to ${pad(toD)}-${pad(toM)}-${toY})`;

          this.calendarSessions.delete(`${chatId}:${userId}`);
          this.calendarSessions.delete(`${chatId}`);

          await this.answerCallbackQuery(
            token,
            cb.id,
            `Generating ${label}...`,
          );

          const reportHtml = await this.generateReport(start, end, label);
          const edited = await this.editMessage(
            token,
            chatId,
            messageId,
            reportHtml,
            this.getReportBackKeyboard(),
          );
          if (!edited) {
            await this.sendMessage(
              token,
              chatId,
              reportHtml,
              messageId,
              this.getReportBackKeyboard(),
            );
          }
          return;
        }
      }
    }

    if (data.startsWith('rep_')) {
      const presetKey = data.replace(/^rep_/, '');
      const presetRange = this.getDateRangeForPreset(presetKey);
      if (presetRange) {
        await this.answerCallbackQuery(
          token,
          cb.id,
          `Generating ${presetRange.label}...`,
        );
        const reportHtml = await this.generateReport(
          presetRange.start,
          presetRange.end,
          presetRange.label,
        );
        const edited = await this.editMessage(
          token,
          chatId,
          messageId,
          reportHtml,
          this.getReportBackKeyboard(),
        );
        if (!edited) {
          await this.sendMessage(
            token,
            chatId,
            reportHtml,
            messageId,
            this.getReportBackKeyboard(),
          );
        }
        return;
      }
    }

    await this.answerCallbackQuery(token, cb.id);
  }

  private async handleMessage(
    msg: {
      message_id: number;
      date: number;
      chat: { id: number | string; title?: string; type: string };
      from?: { id: number; username?: string; first_name?: string };
      text?: string;
      reply_to_message?: { message_id: number; from?: { is_bot?: boolean } };
    },
    token: string,
    botName: string,
  ) {
    if (!msg.text || msg.date < this.botStartTime) {
      return;
    }

    const trimmedText = msg.text.trim();
    const parts = trimmedText.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    // 1. Check if user provided date range directly in the message
    const parsedRange = this.parseDateRange(trimmedText);
    const stateKeyUser = `${msg.chat.id}:${msg.from?.id}`;
    const stateKeyChat = `${msg.chat.id}`;
    const state =
      this.awaitingCustomDate.get(stateKeyUser) ||
      this.awaitingCustomDate.get(stateKeyChat);
    const isRecentState = state && Date.now() - state.timestamp < 15 * 60 * 1000;
    const isReplyToBot =
      msg.reply_to_message?.from?.is_bot ||
      (state && msg.reply_to_message?.message_id === state.messageId);

    if (parsedRange) {
      this.awaitingCustomDate.delete(stateKeyUser);
      this.awaitingCustomDate.delete(stateKeyChat);

      this.logger.log(
        `[${botName}] Generating custom report for ${parsedRange.label} in chat=${msg.chat.id}`,
      );
      DailyLogger.log(
        `Custom date report ${parsedRange.label} requested by @${msg.from?.username || msg.from?.id} in chat ${msg.chat.id} via ${botName}`,
        'TelegramBotService',
      );

      const reportHtml = await this.generateReport(
        parsedRange.start,
        parsedRange.end,
        parsedRange.label,
      );
      await this.sendMessage(
        token,
        msg.chat.id,
        reportHtml,
        msg.message_id,
        this.getReportBackKeyboard(),
      );
      return;
    }

    // 2. If user is in awaiting state or replying to custom range prompt, but format was invalid
    if (
      (isRecentState && isReplyToBot) ||
      (isRecentState && msg.chat.type === 'private')
    ) {
      if (!command.startsWith('/')) {
        const errorText =
          `⚠️ <b>Invalid date range format</b>\n\n` +
          `Please provide the date range in format:\n` +
          `<code>DD-MM-YY to DD-MM-YY</code>\n\n` +
          `<b>Example:</b>\n` +
          `<code>10-09-26 to 17-09-26</code>`;
        await this.sendMessage(
          token,
          msg.chat.id,
          errorText,
          msg.message_id,
          this.getCustomRangeKeyboard(),
        );
        return;
      }
    }

    // 3. Command handling: /report, /today, /stats, /daily
    if (
      command === '/report' ||
      command.startsWith('/report@') ||
      command === '/today' ||
      command.startsWith('/today@') ||
      command === '/stats' ||
      command.startsWith('/stats@') ||
      command === '/daily' ||
      command.startsWith('/daily@')
    ) {
      this.logger.log(
        `[${botName}] Received ${command} from user=@${msg.from?.username || msg.from?.id} in chat=${msg.chat.id}`,
      );
      DailyLogger.log(
        `Telegram command ${command} executed by @${msg.from?.username || msg.from?.id} in chat ${msg.chat.id} via ${botName}`,
        'TelegramBotService',
      );

      // If user passed preset or custom argument directly, e.g. /report 7d or /report 24h
      if (args) {
        const presetRange = this.getDateRangeForPreset(args);
        if (presetRange) {
          const reportHtml = await this.generateReport(
            presetRange.start,
            presetRange.end,
            presetRange.label,
          );
          await this.sendMessage(
            token,
            msg.chat.id,
            reportHtml,
            msg.message_id,
            this.getReportBackKeyboard(),
          );
          return;
        }

        if (args.toLowerCase() === 'custom') {
          const now = new Date();
          const istOffsetMs = 5.5 * 60 * 60 * 1000;
          const istNow = new Date(now.getTime() + istOffsetMs);
          const currentYear = istNow.getUTCFullYear();
          const currentMonth = istNow.getUTCMonth();

          const session: CalendarSession = {
            step: 'from',
            viewYear: currentYear,
            viewMonth: currentMonth,
            tentativeDay: null,
            updatedAt: Date.now(),
          };

          const sent = await this.sendMessage(
            token,
            msg.chat.id,
            this.getCalendarMessageText(session),
            msg.message_id,
            this.buildCalendarKeyboard(session),
          );
          if (sent) {
            session.messageId = sent.message_id;
            this.calendarSessions.set(`${msg.chat.id}:${msg.from?.id}`, session);
            this.calendarSessions.set(`${msg.chat.id}`, session);
          }
          return;
        }
      }

      // Default: show the interactive menu with period buttons
      const menuText =
        `📊 <b>TrustO Performance Report</b>\n\n` +
        `Please select a time period for the report:`;
      await this.sendMessage(
        token,
        msg.chat.id,
        menuText,
        msg.message_id,
        this.getReportMenuKeyboard(),
      );
      return;
    } else if (
      command === '/summary' ||
      command.startsWith('/summary@')
    ) {
      this.logger.log(
        `[${botName}] Received ${command} from user=@${msg.from?.username || msg.from?.id} in chat=${msg.chat.id}`,
      );
      DailyLogger.log(
        `Telegram command ${command} executed by @${msg.from?.username || msg.from?.id} in chat ${msg.chat.id} via ${botName}`,
        'TelegramBotService',
      );
      const summaryHtml = await this.generateTodaySummary();
      await this.sendMessage(token, msg.chat.id, summaryHtml, msg.message_id);
      return;
    } else if (
      command === '/help' ||
      command.startsWith('/help@') ||
      command === '/start' ||
      command.startsWith('/start@')
    ) {
      const isTransactionBot = botName === 'TransactionBot';
      const helpHtml = isTransactionBot
        ? `🤖 <b>TrustO Transaction & Report Bot</b>\n\n` +
          `Available Commands:\n` +
          `• <code>/report</code> — Choose a period (24h, 1d, 3d, 7d, 1m, 1y, Custom) to generate summary report\n` +
          `• <code>/summary</code> — Instant today summary (USDT rate, recharge, withdrawals)\n` +
          `• <code>/report 24h</code> — Quick report for last 24 hours\n` +
          `• <code>/report 7d</code> — Quick report for last 7 days\n` +
          `• <code>/stats</code> — View report menu\n` +
          `• <code>/help</code> — Show this help menu`
        : `🤖 <b>TrustO Security & Report Bot</b>\n\n` +
          `Available Commands:\n` +
          `• <code>/report</code> — Choose a period (24h, 1d, 3d, 7d, 1m, 1y, Custom) to generate summary report\n` +
          `• <code>/summary</code> — Instant today summary (USDT rate, recharge, withdrawals)\n` +
          `• <code>/report 24h</code> — Quick report for last 24 hours\n` +
          `• <code>/report 7d</code> — Quick report for last 7 days\n` +
          `• <code>/stats</code> — View report menu\n` +
          `• <code>/help</code> — Show this help menu`;
      await this.sendMessage(token, msg.chat.id, helpHtml, msg.message_id);
    }
  }

  async generateDailyReport(): Promise<string> {
    const range = this.getDateRangeForPreset('1d')!;
    return this.generateReport(range.start, range.end, range.label);
  }

  async generateReport(
    startDate: Date,
    endDate: Date,
    label: string,
  ): Promise<string> {
    const now = new Date();
    const dateFilter = { $gte: startDate, $lte: endDate };

    const [deposits, withdrawals, disputes, tickets, newUsersCount] =
      await Promise.all([
        this.depositModel.find({
          $or: [
            { createdAt: dateFilter },
            { timestamp: dateFilter },
          ],
        }).lean(),
        this.withdrawalModel.find({
          createdAt: dateFilter,
        }).lean(),
        this.disputeModel.find({
          createdAt: dateFilter,
        }).lean(),
        this.ticketModel.find({
          createdAt: dateFilter,
        }).lean(),
        this.userModel.countDocuments({
          createdAt: dateFilter,
        }),
      ]);

    // Deposits metrics
    const totalDepositCount = deposits.length;
    const totalDepositUsdt = deposits.reduce(
      (sum, d) => sum + (d.amount || 0),
      0,
    );

    // Withdrawals metrics
    const totalWithdrawalCount = withdrawals.length;
    const totalWithdrawalUsdt = withdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    const paidWithdrawals = withdrawals.filter(
      (w) => w.status === WithdrawalStatus.Paid,
    );
    const paidCount = paidWithdrawals.length;
    const paidUsdt = paidWithdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    const pendingWithdrawals = withdrawals.filter(
      (w) =>
        w.status === WithdrawalStatus.Pending ||
        w.status === WithdrawalStatus.Processing ||
        w.status === WithdrawalStatus.Reserved ||
        w.status === WithdrawalStatus.AwaitingPayment,
    );
    const pendingCount = pendingWithdrawals.length;
    const pendingUsdt = pendingWithdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    const failedWithdrawals = withdrawals.filter(
      (w) => w.status === WithdrawalStatus.Failed,
    );
    const failedCount = failedWithdrawals.length;
    const failedUsdt = failedWithdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    const resolvedWithdrawals = withdrawals.filter(
      (w) => w.status === WithdrawalStatus.Resolved,
    );
    const resolvedCount = resolvedWithdrawals.length;
    const resolvedUsdt = resolvedWithdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    // Disputes metrics
    const totalDisputesCount = disputes.length;
    const pendingDisputesCount = disputes.filter(
      (d) => d.resolutionStatus === TicketResolutionStatus.Pending,
    ).length;
    const resolvedDisputesCount = disputes.filter(
      (d) => d.resolutionStatus === TicketResolutionStatus.Resolved,
    ).length;

    // Tickets metrics
    const totalTicketsCount = tickets.length;
    const pendingTicketsCount = tickets.filter(
      (t) => t.resolutionStatus === TicketResolutionStatus.Pending,
    ).length;
    const resolvedTicketsCount = tickets.filter(
      (t) => t.resolutionStatus === TicketResolutionStatus.Resolved,
    ).length;

    // Total transactions
    const totalTransactions = totalDepositCount + totalWithdrawalCount;

    const formatDateIst = (d: Date) =>
      d.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

    const formatTimeIst = (d: Date) =>
      d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });

    const startStr = formatDateIst(startDate);
    const endStr = formatDateIst(endDate);
    const dateRangeDisplay =
      startStr === endStr
        ? `${startStr} (IST)`
        : `${startStr} to ${endStr} (IST)`;

    const nowTimeStr = formatTimeIst(now);
    const nowDateStr = formatDateIst(now);

    const formatUsdt = (num: number) =>
      num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const isToday =
      label.toLowerCase().includes('today') ||
      label.toLowerCase().includes('1 day');

    const is24h =
      label.toLowerCase().includes('24h') ||
      label.toLowerCase().includes('24 hours') ||
      label.toLowerCase().includes('24hours') ||
      label.toLowerCase().includes('24_hours');

    let activeCustomersCount = 0;
    if (is24h) {
      const [depUsers, depWallets, wdUsers] = await Promise.all([
        this.depositModel.distinct('userId', {
          $or: [
            { createdAt: dateFilter },
            { timestamp: dateFilter },
          ],
        }),
        this.depositModel.distinct('walletAddress', {
          userId: null,
          $or: [
            { createdAt: dateFilter },
            { timestamp: dateFilter },
          ],
        }),
        this.withdrawalModel.distinct('userId', {
          createdAt: dateFilter,
        }),
      ]);
      const activeUserSet = new Set<string>();
      for (const id of depUsers) {
        if (id) activeUserSet.add(id.toString());
      }
      for (const w of depWallets) {
        if (w) activeUserSet.add(`wallet:${w}`);
      }
      for (const id of wdUsers) {
        if (id) activeUserSet.add(id.toString());
      }
      activeCustomersCount = activeUserSet.size;
    }

    return (
      `📊 <b>TrustO Performance Report</b>\n` +
      `⏳ <b>Period:</b> <code>${label}</code>\n` +
      `📅 <b>Date Range:</b> <code>${dateRangeDisplay}</code>\n` +
      `⏱ <b>Generated:</b> <code>${nowDateStr}, ${nowTimeStr} (IST)</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📈 <b>TRANSACTION SUMMARY</b>\n` +
      `• <b>Total Transactions:</b> <code>${totalTransactions}</code>\n` +
      `• <b>Total Recharge:</b> <code>${totalDepositCount}</code> (<b>${formatUsdt(totalDepositUsdt)} USDT</b>)\n` +
      `• <b>Total Withdrawals:</b> <code>${totalWithdrawalCount}</code> (<b>${formatUsdt(totalWithdrawalUsdt)} USDT</b>)\n` +
      (is24h
        ? `• <b>Active Customers:</b> <code>${activeCustomersCount}</code>\n`
        : '') +
      `\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💸 <b>WITHDRAWAL BREAKDOWN</b>\n` +
      `• ✅ <b>Successful (Paid):</b> <code>${paidCount}</code> (<b>${formatUsdt(paidUsdt)} USDT</b>)\n` +
      `• ⏳ <b>Pending:</b> <code>${pendingCount}</code> (<b>${formatUsdt(pendingUsdt)} USDT</b>)\n` +
      `• ❌ <b>Failed / Cancelled:</b> <code>${failedCount}</code> (<b>${formatUsdt(failedUsdt)} USDT</b>)\n` +
      (resolvedCount > 0
        ? `• ⚖️ <b>Resolved:</b> <code>${resolvedCount}</code> (<b>${formatUsdt(resolvedUsdt)} USDT</b>)\n`
        : '') +
      `\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚠️ <b>DISPUTES & TICKETS</b>\n` +
      `• 🚩 <b>Disputes Raised:</b> <code>${totalDisputesCount}</code>\n` +
      `  └ ⏳ <i>Under Review:</i> <code>${pendingDisputesCount}</code> | ✅ <i>Resolved:</i> <code>${resolvedDisputesCount}</code>\n` +
      `• 🎫 <b>Support Tickets:</b> <code>${totalTicketsCount}</code>\n` +
      `  └ ⏳ <i>Open / Pending:</i> <code>${pendingTicketsCount}</code> | ✅ <i>Closed:</i> <code>${resolvedTicketsCount}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>USER GROWTH</b>\n` +
      `• <b>${isToday ? 'New Registrations Today:' : 'New Registrations in Period:'}</b> <code>${newUsersCount}</code>`
    );
  }

  private async sendMessage(
    token: string,
    chatId: number | string,
    htmlText: string,
    replyToMessageId?: number,
    replyMarkup?: any,
  ): Promise<{ message_id: number } | null> {
    if (!token) return null;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: htmlText,
            parse_mode: 'HTML',
            reply_to_message_id: replyToMessageId,
            reply_markup: replyMarkup,
          }),
        },
      );
      const data = (await res.json()) as any;
      return data?.ok ? data.result : null;
    } catch (err) {
      this.logger.error('Failed to send telegram message', err as Error);
      return null;
    }
  }

  private async editMessage(
    token: string,
    chatId: number | string,
    messageId: number,
    htmlText: string,
    replyMarkup?: any,
  ): Promise<boolean> {
    if (!token) return false;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/editMessageText`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: htmlText,
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          }),
        },
      );
      const data = (await res.json()) as any;
      return !!data?.ok;
    } catch (err) {
      this.logger.error('Failed to edit telegram message', err as Error);
      return false;
    }
  }

  private async answerCallbackQuery(
    token: string,
    callbackQueryId: string,
    text?: string,
    showAlert?: boolean,
  ) {
    if (!token || !callbackQueryId) return;
    try {
      await fetch(
        `https://api.telegram.org/bot${token}/answerCallbackQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackQueryId,
            text,
            show_alert: showAlert,
          }),
        },
      );
    } catch (err) {
      this.logger.error('Failed to answer callback query', err as Error);
    }
  }

  private parseDurationMs(val?: string): number {
    if (!val) return 15 * 60 * 1000;
    const trimmed = val.trim().toLowerCase();
    if (
      trimmed === '0' ||
      trimmed === 'off' ||
      trimmed === 'false' ||
      trimmed === 'disabled'
    ) {
      return 0;
    }
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/);
    if (!match) {
      const parsed = parseFloat(trimmed);
      return !isNaN(parsed) && parsed > 0 ? parsed * 60 * 1000 : 15 * 60 * 1000;
    }
    const num = parseFloat(match[1]);
    const unit = match[2] || 'm';
    if (unit === 's') return Math.round(num * 1000);
    if (unit === 'm') return Math.round(num * 60 * 1000);
    if (unit === 'h') return Math.round(num * 60 * 60 * 1000);
    if (unit === 'd') return Math.round(num * 24 * 60 * 60 * 1000);
    return 15 * 60 * 1000;
  }

  async dispatchPeriodicSummary() {
    const token =
      process.env.TELEGRAM_TRANSACTION_BOT_TOKEN?.trim() ||
      this.config.get<string>('telegramTransactionBotToken')?.trim();

    if (!token) return;

    const envChatId =
      process.env.TELEGRAM_TRANSACTION_CHAT_ID?.trim() ||
      this.config.get<string>('telegramTransactionChatId')?.trim();

    const targetChatIds = new Set<string>();
    if (envChatId) targetChatIds.add(envChatId);
    for (const cid of this.knownChatIds) targetChatIds.add(cid);

    if (targetChatIds.size === 0) {
      return;
    }

    try {
      const summaryHtml = await this.generateTodaySummary();
      for (const chatId of targetChatIds) {
        await this.sendMessage(token, chatId, summaryHtml);
      }
      this.logger.log(
        `Periodic Deposit & Withdraw summary dispatched to ${targetChatIds.size} chat(s)`,
      );
    } catch (err) {
      this.logger.error('Failed to dispatch periodic summary', err as Error);
    }
  }

  async generateTodaySummary(): Promise<string> {
    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffsetMs);
    const startOfTodayIst = new Date(
      Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth(),
        istNow.getUTCDate(),
        0,
        0,
        0,
        0,
      ) - istOffsetMs,
    );
    const endOfTodayIst = new Date(
      startOfTodayIst.getTime() + 24 * 60 * 60 * 1000 - 1,
    );

    const dateFilter = { $gte: startOfTodayIst, $lte: endOfTodayIst };

    const [
      pricing,
      deposits,
      withdrawals,
      newUsersCount,
      activeDepUsers,
      activeDepWallets,
      activeWdUsers,
    ] = await Promise.all([
      this.pricingSettingsModel
        .findOne({ key: 'global' })
        .lean()
        .catch(() => null),
      this.depositModel
        .find({
          $or: [
            { createdAt: dateFilter },
            { timestamp: dateFilter },
          ],
        })
        .lean(),
      this.withdrawalModel
        .find({
          createdAt: dateFilter,
        })
        .lean(),
      this.userModel.countDocuments({
        createdAt: dateFilter,
      }),
      this.depositModel.distinct('userId', {
        $or: [
          { createdAt: dateFilter },
          { timestamp: dateFilter },
        ],
      }),
      this.depositModel.distinct('walletAddress', {
        userId: null,
        $or: [
          { createdAt: dateFilter },
          { timestamp: dateFilter },
        ],
      }),
      this.withdrawalModel.distinct('userId', {
        createdAt: dateFilter,
      }),
    ]);

    // Active customers today
    const activeSet = new Set<string>();
    for (const id of activeDepUsers) if (id) activeSet.add(id.toString());
    for (const w of activeDepWallets) if (w) activeSet.add(`wallet:${w}`);
    for (const id of activeWdUsers) if (id) activeSet.add(id.toString());
    const activeCustomersCount = activeSet.size;

    // USDT Rate Today
    const inrPrice = pricing?.inrPrice ?? 100;
    const upiPrice = pricing?.upiInrPrice;
    const rateDisplay =
      upiPrice && upiPrice !== inrPrice
        ? `₹${inrPrice.toFixed(2)} (Bank) | ₹${upiPrice.toFixed(2)} (UPI)`
        : `₹${inrPrice.toFixed(2)}`;

    // Total Recharge Today (Deposits)
    const totalDepositCount = deposits.length;
    const totalDepositUsdt = deposits.reduce(
      (sum, d) => sum + (d.amount || 0),
      0,
    );

    // Total Withdrawals Today
    const totalWithdrawalCount = withdrawals.length;
    const totalWithdrawalUsdt = withdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    // Success Withdrawals Today
    const paidWithdrawals = withdrawals.filter(
      (w) => w.status === WithdrawalStatus.Paid,
    );
    const paidCount = paidWithdrawals.length;
    const paidUsdt = paidWithdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    // Pending Withdrawals Today
    const pendingWithdrawals = withdrawals.filter(
      (w) =>
        w.status === WithdrawalStatus.Pending ||
        w.status === WithdrawalStatus.Processing ||
        w.status === WithdrawalStatus.Reserved ||
        w.status === WithdrawalStatus.AwaitingPayment,
    );
    const pendingCount = pendingWithdrawals.length;
    const pendingUsdt = pendingWithdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    // Failed Withdrawals Today
    const failedWithdrawals = withdrawals.filter(
      (w) => w.status === WithdrawalStatus.Failed,
    );
    const failedCount = failedWithdrawals.length;
    const failedUsdt = failedWithdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0,
    );

    const formatUsdt = (num: number) =>
      num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    const nowDateStr = now.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const nowTimeStr = now.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    return (
      `📊 <b>TrustO Deposit & Withdrawal Summary</b>\n` +
      `📅 <b>Date:</b> <code>${nowDateStr} (IST)</code>\n` +
      `⏱ <b>Time:</b> <code>${nowTimeStr}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>USDT Rate Today:</b> <code>${rateDisplay}</code>\n` +
      `👥 <b>Total New Registrations Today:</b> <code>${newUsersCount}</code>\n` +
      `🔥 <b>Total Active Customers:</b> <code>${activeCustomersCount}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `📥 <b>Total Recharge Today:</b> <code>${totalDepositCount}</code> (<b>${formatUsdt(totalDepositUsdt)} USDT</b>)\n` +
      `📤 <b>Total Withdrawals Today:</b> <code>${totalWithdrawalCount}</code> (<b>${formatUsdt(totalWithdrawalUsdt)} USDT</b>)\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `💸 <b>WITHDRAWAL BREAKDOWN TODAY</b>\n` +
      `• ✅ <b>Success Withdrawals Today:</b> <code>${paidCount}</code> (<b>${formatUsdt(paidUsdt)} USDT</b>)\n` +
      `• ⏳ <b>Pending Withdrawals Today:</b> <code>${pendingCount}</code> (<b>${formatUsdt(pendingUsdt)} USDT</b>)\n` +
      `• ❌ <b>Failed Withdrawals Today:</b> <code>${failedCount}</code> (<b>${formatUsdt(failedUsdt)} USDT</b>)`
    );
  }
}

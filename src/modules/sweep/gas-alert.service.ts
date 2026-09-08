import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TronService } from './tron.service';
import { DailyLogger } from '../../common/daily-logger';

export type GasAlertLevel = 'CRITICAL' | 'URGENT' | 'WARNING' | 'HEALTHY';

export interface GasWalletStatus {
  gasFeeWalletAddress: string;
  usdtDestinationAddress: string;
  trxBalance: number;
  usdtBalance: number;
  destinationTrxBalance?: number;
  destinationUsdtBalance?: number;
  isAlert: boolean;
  alertLevel: GasAlertLevel;
  triggeredThreshold: number | null;
  lastCheckedAt: string;
  thresholds: {
    warning: number;
    urgent: number;
    critical: number;
  };
}

@Injectable()
export class GasAlertService {
  private readonly logger = new Logger(GasAlertService.name);

  // Thresholds in TRX
  private readonly THRESHOLD_WARNING = 30;
  private readonly THRESHOLD_URGENT = 20;
  private readonly THRESHOLD_CRITICAL = 10;

  // Anti-spam state
  private lastAlertTier: 30 | 20 | 10 | null = null;
  private lastAlertTimestamp = 0;
  private readonly ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown for same tier

  constructor(
    private readonly tronService: TronService,
    private readonly config: ConfigService,
  ) {}

  getGasFeeWalletAddress(): string {
    return (
      this.config.get<string>('sweep.gasFeeWalletAddress') ??
      process.env.GAS_FEE_WALLET_ADDRESS ??
      'TPzEBy29h7hECMymPNRx9mGSqehf6THS2k'
    ).trim();
  }

  getUsdtDestinationAddress(): string {
    return (
      this.config.get<string>('sweep.usdtDestinationAddress') ??
      process.env.USDT_DESTINATION_ADDRESS ??
      'TNSsZwUT1Vnfkn5WaE1yAcS4DUAtqYSQ4y'
    ).trim();
  }

  /**
   * Periodic balance monitor running every 2 minutes.
   */
  @Cron('*/2 * * * *')
  async scheduledGasCheck(): Promise<void> {
    try {
      await this.checkAndNotifyGasBalance(false);
    } catch (err) {
      this.logger.error(
        `Scheduled gas wallet check failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Check balance on-chain and send alert if threshold crossed.
   */
  async checkAndNotifyGasBalance(forceSend = false): Promise<GasWalletStatus> {
    const gasAddress = this.getGasFeeWalletAddress();
    const destinationAddress = this.getUsdtDestinationAddress();

    let trxBalance = 0;
    let usdtBalance = 0;
    let destTrxBalance = 0;
    let destUsdtBalance = 0;

    try {
      [trxBalance, usdtBalance, destTrxBalance, destUsdtBalance] = await Promise.all([
        this.tronService.getTrxBalance(gasAddress).catch(() => 0),
        this.tronService.getUsdtBalance(gasAddress).catch(() => 0),
        this.tronService.getTrxBalance(destinationAddress).catch(() => 0),
        this.tronService.getUsdtBalance(destinationAddress).catch(() => 0),
      ]);
    } catch (err) {
      this.logger.error(`Failed to fetch gas balance for ${gasAddress}:`, err);
    }

    const { level, tier, isAlert } = this.calculateAlertTier(trxBalance);

    const status: GasWalletStatus = {
      gasFeeWalletAddress: gasAddress,
      usdtDestinationAddress: destinationAddress,
      trxBalance,
      usdtBalance,
      destinationTrxBalance: destTrxBalance,
      destinationUsdtBalance: destUsdtBalance,
      isAlert,
      alertLevel: level,
      triggeredThreshold: tier,
      lastCheckedAt: new Date().toISOString(),
      thresholds: {
        warning: this.THRESHOLD_WARNING,
        urgent: this.THRESHOLD_URGENT,
        critical: this.THRESHOLD_CRITICAL,
      },
    };

    await this.handleAlertNotification(status, tier, forceSend);

    return status;
  }

  private calculateAlertTier(trxBalance: number): {
    level: GasAlertLevel;
    tier: 30 | 20 | 10 | null;
    isAlert: boolean;
  } {
    if (trxBalance <= this.THRESHOLD_CRITICAL) {
      return { level: 'CRITICAL', tier: 10, isAlert: true };
    }
    if (trxBalance <= this.THRESHOLD_URGENT) {
      return { level: 'URGENT', tier: 20, isAlert: true };
    }
    if (trxBalance <= this.THRESHOLD_WARNING) {
      return { level: 'WARNING', tier: 30, isAlert: true };
    }
    return { level: 'HEALTHY', tier: null, isAlert: false };
  }

  private async handleAlertNotification(
    status: GasWalletStatus,
    currentTier: 30 | 20 | 10 | null,
    forceSend: boolean,
  ): Promise<void> {
    const now = Date.now();

    // 1. Force send (e.g. Test Alert button from Super Admin UI)
    if (forceSend) {
      await this.dispatchTelegramAlert(status, true);
      this.lastAlertTier = currentTier;
      this.lastAlertTimestamp = now;
      return;
    }

    // 2. Recovery: Was previously in alert tier and now refilled > 30 TRX
    if (currentTier === null && this.lastAlertTier !== null) {
      this.logger.log(
        `Gas wallet refilled. Balance: ${status.trxBalance} TRX. Resetting alert state.`,
      );
      await this.dispatchTelegramRecoveryNotice(status);
      this.lastAlertTier = null;
      this.lastAlertTimestamp = now;
      return;
    }

    // 3. In healthy state, do nothing
    if (currentTier === null) {
      return;
    }

    // 4. Entering alert tier for first time or escalating to a worse tier (e.g. 30 -> 20 or 20 -> 10)
    const isNewTier = this.lastAlertTier === null || currentTier < this.lastAlertTier;
    const isCooldownElapsed = now - this.lastAlertTimestamp > this.ALERT_COOLDOWN_MS;

    if (isNewTier || isCooldownElapsed) {
      this.logger.warn(
        `[GasAlertService] Gas threshold triggered: <= ${currentTier} TRX (Current: ${status.trxBalance} TRX). Sending Security Bot alert.`,
      );
      await this.dispatchTelegramAlert(status, false);
      this.lastAlertTier = currentTier;
      this.lastAlertTimestamp = now;
    }
  }

  private async dispatchTelegramAlert(
    status: GasWalletStatus,
    isTest = false,
  ): Promise<void> {
    const token = process.env.TELEGRAM_ALERT_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;

    if (!token || !chatId) {
      this.logger.warn('TELEGRAM_ALERT_BOT_TOKEN or TELEGRAM_ALERT_CHAT_ID not configured.');
      return;
    }

    const testPrefix = isTest ? '🧪 <b>[TEST ALERT]</b>\n' : '';
    const icon =
      status.alertLevel === 'CRITICAL'
        ? '🚨'
        : status.alertLevel === 'URGENT'
        ? '⚠️'
        : status.alertLevel === 'WARNING'
        ? '⚡'
        : '⛽';

    const thresholdText =
      status.triggeredThreshold !== null
        ? `&lt;= ${status.triggeredThreshold} TRX Threshold`
        : 'Manual Check';

    const text =
      `${testPrefix}${icon} <b>GAS WALLET ALERT — ${status.alertLevel}</b>\n` +
      `<b>Time:</b> <code>${new Date().toISOString()}</code>\n` +
      `<b>Module:</b> <code>GasFeeWalletMonitor</code>\n\n` +
      `<b>Alert Trigger:</b> ${thresholdText}\n` +
      `<b>Current TRX Balance:</b> <code>${status.trxBalance.toFixed(4)} TRX</code>\n` +
      `<b>Current USDT Balance:</b> <code>${status.usdtBalance.toFixed(2)} USDT</code>\n\n` +
      `<b>Gas Dispenser Address:</b>\n` +
      `<code>${status.gasFeeWalletAddress}</code>\n\n` +
      `👉 <b>Action Required:</b> Please top up TRX to the Gas Wallet to ensure uninterrupted auto-sweeps and operations.`;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`Telegram API response error: ${body}`);
      } else {
        DailyLogger.log(
          `[GasAlert] Telegram alert dispatched successfully (Level: ${status.alertLevel}, Balance: ${status.trxBalance} TRX)`,
          'GasAlertService',
        );
      }
    } catch (err) {
      this.logger.error('Failed to dispatch Telegram gas alert:', err);
    }
  }

  private async dispatchTelegramRecoveryNotice(
    status: GasWalletStatus,
  ): Promise<void> {
    const token = process.env.TELEGRAM_ALERT_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;

    if (!token || !chatId) return;

    const text =
      `✅ <b>GAS WALLET REFILLED &amp; HEALTHY</b>\n` +
      `<b>Time:</b> <code>${new Date().toISOString()}</code>\n` +
      `<b>Module:</b> <code>GasFeeWalletMonitor</code>\n\n` +
      `<b>Current TRX Balance:</b> <code>${status.trxBalance.toFixed(4)} TRX</code>\n` +
      `<b>Status:</b> All sweep and fee funding operations running smoothly.\n\n` +
      `<b>Gas Dispenser Address:</b>\n` +
      `<code>${status.gasFeeWalletAddress}</code>`;

    try {
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
      this.logger.error('Failed to send gas wallet recovery Telegram notice:', err);
    }
  }
}

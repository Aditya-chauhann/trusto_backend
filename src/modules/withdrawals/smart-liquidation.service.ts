import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Withdrawal,
  WithdrawalDocument,
  WithdrawalStatus,
} from './schemas/withdrawal.schema';
import {
  SmartReservation,
  SmartReservationDocument,
  SmartReservationStatus,
} from './schemas/smart-reservation.schema';
import { UpiAccountsService } from './upi-accounts.service';
import { PricingService } from '../pricing/pricing.service';
import { DepositsService } from '../deposits/deposits.service';
import { PayoutBridgeService } from '../payout-bridge/payout-bridge.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationEvent } from '../notifications/notification-events';
import { round2, SMART_TOGGLE_MIN_USDT } from './constants';

// Don't arm below this many INR — avoids offering dust that no offer can match.
const SMART_MIN_INR = 1;

// How often to reconcile: re-register held reservations and arm idle balance.
const RECONCILE_INTERVAL_MS = 60_000;

/**
 * Smart UPI auto-liquidation with full-balance reservations. When Smart is on,
 * one held reservation covers the entire available balance. On each match the
 * matched amount locks and the remainder is re-armed as a new reservation so
 * large LP offers and parallel in-flight payouts both work without fixed chunks.
 */
@Injectable()
export class SmartLiquidationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SmartLiquidationService.name);
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(SmartReservation.name)
    private readonly reservationModel: Model<SmartReservationDocument>,
    private readonly upiAccounts: UpiAccountsService,
    private readonly pricing: PricingService,
    @Inject(forwardRef(() => DepositsService))
    private readonly deposits: DepositsService,
    private readonly payoutBridge: PayoutBridgeService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    void this.reconcile();
    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch((err) =>
        this.logger.error('[SmartToggle] reconcile failed', err as Error),
      );
    }, RECONCILE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  async reconcile(): Promise<void> {
    // 1. Self-heal: cancel any held reservation that should no longer be offered
    //    — its owner turned Smart off / was blocked or frozen, or its snapshotted
    //    UPI was deleted, deactivated, or un-approved. This is what stops the
    //    payout bridge (and its Telegram group) from re-announcing payouts to a
    //    UPI the user no longer has in their Added-UPI list.
    await this.cleanupInvalidReservations();

    // 2. Arm idle balance and re-register live reservations for eligible users.
    //    Blocked/frozen users are excluded so we never re-announce for them.
    const users = await this.userModel
      .find({
        smartUpiSelectionEnabled: true,
        isBlocked: { $ne: true },
        isFrozen: { $ne: true },
      })
      .select(
        '_id smartReservationRef smartReservationUpiId smartReservationFxRate smartReservationCeilingInr',
      );
    for (const u of users) {
      const userId = (u._id as Types.ObjectId).toString();
      await this.migrateLegacyReservation(u);
      await this.tryArmAllAvailable(userId);
      const held = await this.reservationModel.find({
        userId: u._id,
        status: SmartReservationStatus.Held,
      });
      for (const res of held) {
        if (res.ceilingInr >= SMART_MIN_INR) {
          void this.payoutBridge.registerPayoutRequest({
            referenceId: res.referenceId,
            amount: res.ceilingInr,
            upiId: res.upiId,
            accountHolderName: res.accountHolderName ?? undefined,
            smart: true,
          });
        }
      }
    }
  }

  /**
   * Cancel every held reservation that is no longer valid. A reservation is
   * invalid when its owner turned Smart off, was blocked/frozen, or when its
   * snapshotted UPI is no longer a live active + approved UPI for that user.
   * Cancelling calls the bridge DELETE, which pulls the Telegram announcement.
   */
  private async cleanupInvalidReservations(): Promise<void> {
    const held = await this.reservationModel.find({
      status: SmartReservationStatus.Held,
    });
    for (const res of held) {
      if (await this.isReservationStillValid(res)) continue;
      this.logger.warn(
        `[SmartToggle] cancelling stale reservation ${res.referenceId} ` +
          `(user ${res.userId.toString()}, UPI ${res.upiId}) — no longer valid.`,
      );
      await this.cancelReservation(res.referenceId);
    }
  }

  private async isReservationStillValid(
    res: SmartReservationDocument,
  ): Promise<boolean> {
    const user = await this.userModel
      .findById(res.userId)
      .select('smartUpiSelectionEnabled isBlocked isFrozen');
    if (
      !user ||
      !user.smartUpiSelectionEnabled ||
      user.isBlocked ||
      user.isFrozen
    ) {
      return false;
    }

    const minUsdt = await this.getSmartToggleMinUsdt();
    const balance = await this.getAvailableBalanceWithoutReservation(
      res.userId.toString(),
    );
    if (balance < minUsdt) {
      this.logger.warn(
        `[SmartToggle] Auto-disabling Smart UPI for user ${res.userId.toString()}: balance ${balance} USDT < ${minUsdt} USDT.`,
      );
      await this.userModel.updateOne(
        { _id: res.userId },
        { $set: { smartUpiSelectionEnabled: false } },
      );
      return false;
    }

    return this.upiAccounts.isUpiActiveApprovedForUser(
      res.userId.toString(),
      res.upiId,
    );
  }

  /**
   * A UPI was just deleted or deactivated. Immediately cancel any held
   * reservation still pointing at it (pulling the Telegram announcement) and
   * re-arm on a remaining valid UPI — without waiting for the next reconcile
   * sweep. Reservations pointing at other, still-valid UPIs are left untouched.
   */
  async handleUpiRemoved(userId: string, upiId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return;
    const held = await this.reservationModel.find({
      userId: new Types.ObjectId(userId),
      status: SmartReservationStatus.Held,
      upiId: upiId.toLowerCase(),
    });
    if (held.length === 0) return;
    for (const res of held) {
      await this.cancelReservation(res.referenceId);
    }
    this.logger.log(
      `[SmartToggle] UPI ${upiId} removed for user ${userId}: cancelled ` +
        `${held.length} held reservation(s); re-arming on a remaining UPI.`,
    );
    await this.tryArmAllAvailable(userId);
  }

  /** Backward-compatible alias used by upi-accounts toggle. */
  async arm(userId: string): Promise<void> {
    await this.tryArmAllAvailable(userId);
  }

  /**
   * Arm one full-balance reservation when none is currently held. Called on
   * Smart enable, deposit, match, fill, and decline to offer the remainder.
   */
  async tryArmAllAvailable(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return;
    if (!(await this.isEnabled(userId))) return;

    const minUsdt = await this.getSmartToggleMinUsdt();
    const balance = await this.getAvailableBalanceWithoutReservation(userId);
    if (balance < minUsdt) {
      this.logger.warn(
        `[SmartToggle] Auto-disabling Smart UPI for user ${userId}: balance ${balance} USDT < ${minUsdt} USDT.`,
      );
      await this.userModel.updateOne(
        { _id: new Types.ObjectId(userId) },
        { $set: { smartUpiSelectionEnabled: false } },
      );
      await this.disarm(userId);
      return;
    }

    const hasHeld = await this.reservationModel.exists({
      userId: new Types.ObjectId(userId),
      status: SmartReservationStatus.Held,
    });
    if (hasHeld) return;

    const created = await this.createReservation(userId);
    if (created) {
      this.logger.log(
        `[SmartToggle] tryArmAllAvailable user ${userId}: armed full-balance reservation.`,
      );
    }
  }

  async createReservation(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;

    const available = await this.availableUsdt(userId);
    const minUsdt = await this.getSmartToggleMinUsdt();
    if (available < minUsdt) return false;

    const ceilingUsd = round2(available);

    const upiAcc = await this.upiAccounts.getRandomActiveUpiAccountOrNull(userId);
    if (!upiAcc) {
      this.logger.warn(
        `[SmartToggle] createReservation skipped: user ${userId} has no active approved UPI.`,
      );
      return false;
    }
    const upiId = upiAcc.upiId;
    const accountHolderName = upiAcc.accountHolderName;

    const pricing = await this.pricing.getEffectiveForUser(userId);
    const fxRate = pricing.upiInrPrice;
    const ceilingInr = round2(ceilingUsd * fxRate);
    if (ceilingInr < SMART_MIN_INR) return false;

    const referenceId = new Types.ObjectId().toString();
    await this.reservationModel.create({
      userId: new Types.ObjectId(userId),
      referenceId,
      upiId,
      accountHolderName,
      fxRate,
      ceilingInr,
      ceilingUsd,
      status: SmartReservationStatus.Held,
    });

    this.logger.log(
      `[SmartToggle] ARMED user ${userId}: ceiling ₹${ceilingInr} ` +
        `(${ceilingUsd} USDT @ fx ${fxRate}) → UPI ${upiId}, ref ${referenceId}.`,
    );
    void this.payoutBridge.registerPayoutRequest({
      referenceId,
      amount: ceilingInr,
      upiId,
      accountHolderName: accountHolderName ?? undefined,
      smart: true,
    });
    return true;
  }

  async disarm(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return;
    const held = await this.reservationModel.find({
      userId: new Types.ObjectId(userId),
      status: SmartReservationStatus.Held,
    });
    for (const res of held) {
      await this.cancelReservation(res.referenceId);
    }
    if (held.length > 0) {
      this.logger.log(
        `[SmartToggle] DISARMED user ${userId}: cancelled ${held.length} held reservation(s).`,
      );
    }
  }

  async cancelReservation(referenceId: string): Promise<void> {
    const res = await this.reservationModel.findOne({ referenceId });
    if (!res || res.status !== SmartReservationStatus.Held) {
      if (res && res.status === SmartReservationStatus.Matched) {
        this.logger.log(
          `[SmartToggle] cancel skipped: ref ${referenceId} is matched/in-flight.`,
        );
      }
      return;
    }
    const bridgeRes = await this.payoutBridge.cancelPayoutRequest(referenceId);
    if (bridgeRes.cancelled) {
      res.status = SmartReservationStatus.Cancelled;
      await res.save();
      this.logger.log(`[SmartToggle] cancelled held ref ${referenceId}.`);
    }
  }

  async findByReferenceId(
    referenceId: string,
  ): Promise<SmartReservationDocument | null> {
    return this.reservationModel.findOne({ referenceId });
  }

  /** Resolve a reservation by ref, migrating legacy user fields if needed. */
  async findByReferenceIdIncludingLegacy(
    referenceId: string,
  ): Promise<SmartReservationDocument | null> {
    const existing = await this.findByReferenceId(referenceId);
    if (existing) return existing;
    const user = await this.userModel.findOne({
      smartReservationRef: referenceId,
    });
    if (!user) return null;
    await this.migrateLegacyReservation(user);
    return this.findByReferenceId(referenceId);
  }

  async markReservationMatched(
    referenceId: string,
    withdrawalId: Types.ObjectId,
  ): Promise<SmartReservationDocument | null> {
    return this.reservationModel.findOneAndUpdate(
      {
        referenceId,
        status: {
          $in: [
            SmartReservationStatus.Held,
            SmartReservationStatus.Matched,
          ],
        },
      },
      {
        $set: {
          status: SmartReservationStatus.Matched,
          matchedWithdrawalId: withdrawalId,
        },
      },
      { new: true },
    );
  }

  async markReservationFulfilled(referenceId: string): Promise<void> {
    await this.reservationModel.updateOne(
      { referenceId },
      { $set: { status: SmartReservationStatus.Fulfilled } },
    );
  }

  async markReservationUnmatched(referenceId: string): Promise<void> {
    await this.reservationModel.updateOne(
      { referenceId, status: SmartReservationStatus.Matched },
      { $set: { status: SmartReservationStatus.Held }, $unset: { withdrawalId: 1 } },
    );
  }

  async markReservationCancelled(referenceId: string): Promise<void> {
    await this.reservationModel.updateOne(
      {
        referenceId,
        status: {
          $in: [SmartReservationStatus.Held, SmartReservationStatus.Matched],
        },
      },
      { $set: { status: SmartReservationStatus.Cancelled } },
    );
  }

  async sumHeldReservationUsd(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    const [row] = await this.reservationModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          status: SmartReservationStatus.Held,
        },
      },
      { $group: { _id: null, total: { $sum: '$ceilingUsd' } } },
    ]);
    return round2(row?.total ?? 0);
  }

  /** @deprecated Use tryArmAllAvailable. Kept for call-site compatibility. */
  async rearmAfterFill(userId: string): Promise<void> {
    await this.tryArmAllAvailable(userId);
  }

  async ensureArmedForDeposit(userId: string): Promise<void> {
    if (!(await this.isEnabled(userId))) return;
    this.logger.log(
      `[SmartToggle] deposit credited for smart user ${userId} — arming if idle.`,
    );
    await this.tryArmAllAvailable(userId);
  }

  /** @deprecated Legacy no-op — use markReservationFulfilled(referenceId) instead. */
  async clearReservationAfterFill(_userId: Types.ObjectId): Promise<void> {
    // Intentionally empty.
  }

  notifyFill(userId: Types.ObjectId, amountInr: number, upiId: string): void {
    this.logger.log(
      `[SmartToggle] receipt: notifying user ${userId.toString()} of ₹${amountInr} paid to ${upiId}.`,
    );
    void this.notifications.notify(userId, NotificationEvent.SmartPayoutPaid, {
      amountInr,
      upiId,
    });
  }

  private async migrateLegacyReservation(user: UserDocument): Promise<void> {
    if (!user.smartReservationRef) return;
    const existing = await this.reservationModel.findOne({
      referenceId: user.smartReservationRef,
    });
    if (!existing) {
      const upiId = user.smartReservationUpiId;
      const fxRate = user.smartReservationFxRate ?? 0;
      let ceilingInr = user.smartReservationCeilingInr ?? 0;
      if (ceilingInr < SMART_MIN_INR && fxRate > 0) {
        const available = await this.availableUsdt(
          (user._id as Types.ObjectId).toString(),
        );
        ceilingInr = round2(available * fxRate);
      }
      if (upiId && ceilingInr >= SMART_MIN_INR) {
        const minUsdt = await this.getSmartToggleMinUsdt();
        const ceilingUsd =
          fxRate > 0 ? round2(ceilingInr / fxRate) : minUsdt;
        await this.reservationModel.create({
          userId: user._id,
          referenceId: user.smartReservationRef,
          upiId,
          fxRate,
          ceilingInr,
          ceilingUsd,
          status: SmartReservationStatus.Held,
        });
        this.logger.log(
          `[SmartToggle] migrated legacy reservation ${user.smartReservationRef} for user ${user._id.toString()}.`,
        );
      }
    }
    user.smartReservationRef = null;
    user.smartReservationUpiId = null;
    user.smartReservationFxRate = null;
    user.smartReservationCeilingInr = null;
    await user.save();
  }

  private async availableUsdt(userId: string): Promise<number> {
    const [deposits, locked, heldReserved] = await Promise.all([
      this.deposits.sumUserVisibleDepositsFor(userId),
      this.sumLockedFor(userId),
      this.sumHeldReservationUsd(userId),
    ]);
    return round2(deposits - locked - heldReserved);
  }

  private async sumLockedFor(userId: string): Promise<number> {
    const [row] = await this.withdrawalModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          status: { $ne: WithdrawalStatus.Failed },
          $or: [
            { status: { $ne: WithdrawalStatus.AwaitingPayment } },
            { isSmart: true, status: WithdrawalStatus.AwaitingPayment },
          ],
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $subtract: ['$amount', { $ifNull: ['$balanceAdjustmentUsd', 0] }],
            },
          },
        },
      },
    ]);
    return row?.total ?? 0;
  }

  async getAvailableBalanceWithoutReservation(userId: string): Promise<number> {
    const [deposits, locked] = await Promise.all([
      this.deposits.sumUserVisibleDepositsFor(userId),
      this.sumLockedFor(userId),
    ]);
    return round2(Math.max(deposits - locked, 0));
  }

  async getSmartToggleMinUsdt(): Promise<number> {
    return this.pricing.getSmartToggleMinUsdt();
  }

  private async isEnabled(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const user = await this.userModel
      .findById(userId)
      .select('smartUpiSelectionEnabled');
    return Boolean(user?.smartUpiSelectionEnabled);
  }
}

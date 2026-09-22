import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Deposit, DepositDocument } from './schemas/deposit.schema';
import { USER_VISIBLE_DEPOSIT_MIN } from './constants';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationEvent } from '../notifications/notification-events';
import { SmartLiquidationService } from '../withdrawals/smart-liquidation.service';
import { SweepQueueService } from '../sweep/sweep-queue.service';
import {
  SweepJob,
  SweepJobDocument,
  SweepJobStatus,
} from '../sweep/schemas/sweep-job.schema';
import { IpActivityService } from '../ip-activity/ip-activity.service';
import { DailyLogger } from '../../common/daily-logger';

export interface IngestEventPayload {
  walletAddress: string;
  amount: number;
  transactionId: string;
  timestamp: string;
  currency: string;
  [key: string]: unknown;
}

export interface DepositResponse {
  id: string;
  transactionId: string;
  userId: string | null;
  walletAddress: string;
  amount: number;
  currency: string;
  timestamp: string | null;
  createdAt: string;
}

export interface AdminDepositItem extends DepositResponse {
  user: {
    id: string;
    name: string;
    email: string;
    walletAddress?: string;
    serialId?: string;
    phone?: string | null;
  } | null;
  remark: string | null;
  visibleToUser: boolean;
  sweepStatus: string | null;
  sweepTxHash: string | null;
  sweptAt: string | null;
  sweepScheduledAt: string | null;
}

export interface IngestResult {
  created: boolean;
  deposit: DepositDocument;
}

@Injectable()
export class DepositsService {
  constructor(
    @InjectModel(Deposit.name)
    private readonly depositModel: Model<DepositDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(SweepJob.name)
    private readonly sweepJobModel: Model<SweepJobDocument>,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => SmartLiquidationService))
    private readonly smartLiquidation: SmartLiquidationService,
    private readonly sweepQueue: SweepQueueService,
    private readonly ipActivityService: IpActivityService,
  ) {}

  async recordIngested(event: IngestEventPayload): Promise<IngestResult> {
    const cleanAddress = event.walletAddress?.trim();
    const user = cleanAddress
      ? await this.userModel
          .findOne({
            walletAddress: { $regex: new RegExp(`^${cleanAddress}$`, 'i') },
          })
          .select('_id name email phone serialId walletAddress')
      : null;
    const userId = user ? (user._id as Types.ObjectId) : null;

    const update = await this.depositModel.updateOne(
      { transactionId: event.transactionId },
      {
        $setOnInsert: {
          transactionId: event.transactionId,
          userId,
          walletAddress: cleanAddress || event.walletAddress,
          amount: event.amount,
          currency: event.currency,
          timestamp: new Date(event.timestamp),
          rawPayload: { ...event },
        },
      },
      { upsert: true },
    );

    const created = (update.upsertedCount ?? 0) > 0;
    const deposit = (await this.depositModel.findOne({
      transactionId: event.transactionId,
    })) as DepositDocument;

    if (created) {
      const username = user?.serialId || user?.email || (userId ? userId.toString() : 'Guest / Unregistered');
      const name = user?.name || 'Unassigned User';

      void DailyLogger.transactionAlert({
        type: 'Deposit',
        status: 'Confirmed',
        username,
        name,
        amount: `${deposit.amount} ${deposit.currency || 'USDT'}`,
        ipAddress: 'On-Chain (Blockchain Network)',
        time: deposit.timestamp || new Date(),
        destinationOrWallet: deposit.walletAddress,
        txIdOrRef: deposit.transactionId,
      }).catch((err) => {
        DailyLogger.error('Failed to send on-chain deposit transaction alert', err?.stack, 'DepositsService');
      });

      if (userId) {
        void this.ipActivityService.log({
          userId: userId,
          email: user?.email,
          phone: user?.phone,
          actionType: 'deposit',
          ipAddress: 'On-Chain',
          details: {
            amount: deposit.amount.toString(),
            currency: deposit.currency,
            txId: deposit.transactionId,
          },
        }).catch(() => {});

        void this.notifications.notify(userId, NotificationEvent.DepositReceived, {
          amount: deposit.amount,
          currency: deposit.currency,
        });
        // If Smart auto-liquidation is on, offer the freshly-credited balance too.
        void this.smartLiquidation.ensureArmedForDeposit(userId.toString());
      }

      void this.sweepQueue.enqueue(
        deposit.walletAddress,
        deposit._id as Types.ObjectId,
      );
    }

    return { created, deposit };
  }

  async listForUser(userId: string, limit = 50): Promise<DepositResponse[]> {
    const docs = await this.depositModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ timestamp: -1, createdAt: -1 })
      .limit(limit);
    return docs.map((d) => this.toResponse(d));
  }

  async listAllForAdmin(): Promise<AdminDepositItem[]> {
    const docs = await this.depositModel.find().sort({ createdAt: -1 });

    const userIds = Array.from(
      new Set(
        docs
          .map((d) => (d.userId ? d.userId.toString() : null))
          .filter((id): id is string => Boolean(id) && typeof id === 'string' && Types.ObjectId.isValid(id)),
      ),
    );
    const walletAddresses = Array.from(
      new Set(
        docs
          .map((d) => d.walletAddress)
          .filter((w): w is string => Boolean(w) && w !== 'MANUAL_ADJUSTMENT'),
      ),
    );

    const [usersById, usersByWallet, sweepJobs] = await Promise.all([
      userIds.length > 0
        ? this.userModel
            .find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } })
            .select('_id name email walletAddress serialId phone')
        : [],
      walletAddresses.length > 0
        ? this.userModel
            .find({ walletAddress: { $in: walletAddresses } })
            .select('_id name email walletAddress serialId phone')
        : [],
      walletAddresses.length > 0
        ? this.sweepJobModel
            .find({ walletAddress: { $in: walletAddresses } })
            .sort({ createdAt: -1 })
            .exec()
        : Promise.resolve([] as SweepJobDocument[]),
    ]);

    const userMap = new Map<string, { id: string; name: string; email: string; walletAddress?: string; serialId?: string; phone?: string | null }>();
    usersById.forEach((u: any) => {
      userMap.set((u._id as Types.ObjectId).toString(), {
        id: (u._id as Types.ObjectId).toString(),
        name: u.name || u.email,
        email: u.email,
        walletAddress: u.walletAddress,
        serialId: u.serialId || undefined,
        phone: u.phone ?? null,
      });
    });
    usersByWallet.forEach((u: any) => {
      const uid = (u._id as Types.ObjectId).toString();
      if (!userMap.has(uid)) {
        userMap.set(uid, {
          id: uid,
          name: u.name || u.email,
          email: u.email,
          walletAddress: u.walletAddress,
          serialId: u.serialId || undefined,
          phone: u.phone ?? null,
        });
      }
      if (u.walletAddress) {
        userMap.set(`wallet_${u.walletAddress}`, {
          id: uid,
          name: u.name || u.email,
          email: u.email,
          walletAddress: u.walletAddress,
          serialId: u.serialId || undefined,
          phone: u.phone ?? null,
        });
      }
    });

    const jobsByTriggerId = new Map<string, SweepJobDocument>();
    const jobsByWallet = new Map<string, SweepJobDocument[]>();

    (sweepJobs as SweepJobDocument[]).forEach((job: SweepJobDocument) => {
      if (job.triggerDepositId) {
        jobsByTriggerId.set(job.triggerDepositId.toString(), job);
      }
      const addr = job.walletAddress.trim().toLowerCase();
      const list = jobsByWallet.get(addr) ?? [];
      list.push(job);
      jobsByWallet.set(addr, list);
    });

    return docs.map((d) => {
      const resp = this.toResponse(d);
      const uid = d.userId ? d.userId.toString() : null;
      let userObj = uid ? userMap.get(uid) : null;
      if (!userObj && d.walletAddress) {
        userObj = userMap.get(`wallet_${d.walletAddress}`) ?? null;
      }

      const raw = d.rawPayload as Record<string, unknown> | null;
      const remark = raw && typeof raw.remark === 'string' ? raw.remark : null;

      let sweepStatus: string | null = null;
      let sweepTxHash: string | null = null;
      let sweptAt: string | null = null;
      let sweepScheduledAt: string | null = null;

      if (d.walletAddress === 'MANUAL_ADJUSTMENT' || d.transactionId?.startsWith('MANUAL_')) {
        sweepStatus = 'manual';
      } else {
        const dId = (d._id as Types.ObjectId).toString();
        const dTime = (d as any).createdAt
          ? new Date((d as any).createdAt).getTime()
          : (d.timestamp ? new Date(d.timestamp).getTime() : 0);
        const wAddress = d.walletAddress ? d.walletAddress.trim().toLowerCase() : '';
        const walletJobs = jobsByWallet.get(wAddress) ?? [];
        const triggeredJob = jobsByTriggerId.get(dId);

        if (triggeredJob) {
          sweepStatus = triggeredJob.status;
          sweepTxHash = triggeredJob.sweepTxHash ?? null;
          sweptAt = triggeredJob.completedAt ? triggeredJob.completedAt.toISOString() : null;
          sweepScheduledAt = triggeredJob.scheduledAt ? triggeredJob.scheduledAt.toISOString() : null;
        } else {
          const completedJob = walletJobs.find(
            (j) =>
              j.status === SweepJobStatus.Completed &&
              (!j.completedAt || new Date(j.completedAt).getTime() >= dTime - 60_000),
          );
          if (completedJob) {
            sweepStatus = 'completed';
            sweepTxHash = completedJob.sweepTxHash ?? null;
            sweptAt = completedJob.completedAt ? completedJob.completedAt.toISOString() : null;
          } else {
            const activeJob = walletJobs.find(
              (j) =>
                j.status === SweepJobStatus.Sweeping ||
                j.status === SweepJobStatus.FundingGas ||
                j.status === SweepJobStatus.Pending,
            );
            if (activeJob) {
              sweepStatus = activeJob.status;
              sweepTxHash = activeJob.sweepTxHash ?? null;
              sweepScheduledAt = activeJob.scheduledAt ? activeJob.scheduledAt.toISOString() : null;
            } else {
              const failedJob = walletJobs.find((j) => j.status === SweepJobStatus.Failed);
              if (failedJob) {
                sweepStatus = 'failed';
              } else {
                sweepStatus = 'pending';
              }
            }
          }
        }
      }

      return {
        ...resp,
        user: userObj ?? null,
        remark,
        visibleToUser: d.amount > USER_VISIBLE_DEPOSIT_MIN,
        sweepStatus,
        sweepTxHash,
        sweptAt,
        sweepScheduledAt,
      };
    });
  }

  async sumUserVisibleDepositsFor(userId: string): Promise<number> {
    const [row] = await this.depositModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          amount: { $gt: USER_VISIBLE_DEPOSIT_MIN },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return row?.total ?? 0;
  }

  toResponse(deposit: DepositDocument): DepositResponse {
    const createdAt = (deposit as unknown as { createdAt?: Date }).createdAt;
    return {
      id: (deposit._id as Types.ObjectId).toString(),
      transactionId: deposit.transactionId,
      userId: deposit.userId ? deposit.userId.toString() : null,
      walletAddress: deposit.walletAddress,
      amount: deposit.amount,
      currency: deposit.currency,
      timestamp: deposit.timestamp ? deposit.timestamp.toISOString() : null,
      createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
    };
  }
}

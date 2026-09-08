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
import { IpActivityService } from '../ip-activity/ip-activity.service';

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
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => SmartLiquidationService))
    private readonly smartLiquidation: SmartLiquidationService,
    private readonly sweepQueue: SweepQueueService,
    private readonly ipActivityService: IpActivityService,
  ) {}

  async recordIngested(event: IngestEventPayload): Promise<IngestResult> {
    const user = await this.userModel
      .findOne({ walletAddress: event.walletAddress })
      .select('_id email phone');
    const userId = user ? (user._id as Types.ObjectId) : null;

    const update = await this.depositModel.updateOne(
      { transactionId: event.transactionId },
      {
        $setOnInsert: {
          transactionId: event.transactionId,
          userId,
          walletAddress: event.walletAddress,
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

    const [usersById, usersByWallet] = await Promise.all([
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

    return docs.map((d) => {
      const resp = this.toResponse(d);
      const uid = d.userId ? d.userId.toString() : null;
      let userObj = uid ? userMap.get(uid) : null;
      if (!userObj && d.walletAddress) {
        userObj = userMap.get(`wallet_${d.walletAddress}`) ?? null;
      }

      const raw = d.rawPayload as Record<string, unknown> | null;
      const remark = raw && typeof raw.remark === 'string' ? raw.remark : null;

      return {
        ...resp,
        user: userObj ?? null,
        remark,
        visibleToUser: d.amount > USER_VISIBLE_DEPOSIT_MIN,
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

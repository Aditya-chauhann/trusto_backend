import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  UserTag,
  UserTagDocument,
  ThresholdPeriod,
} from './schemas/user-tag.schema';
import {
  Deposit,
  DepositDocument,
} from '../deposits/schemas/deposit.schema';
import {
  Withdrawal,
  WithdrawalDocument,
  WithdrawalStatus,
} from '../withdrawals/schemas/withdrawal.schema';
import { UserTagAssignmentsService } from './user-tag-assignments.service';

export interface EvaluationResult {
  userId: string;
  previousTagId: string | null;
  assignedTagId: string | null;
  upgraded: boolean;
}

@Injectable()
export class TagEvaluatorService {
  private readonly logger = new Logger(TagEvaluatorService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(UserTag.name)
    private readonly tagModel: Model<UserTagDocument>,
    @InjectModel(Deposit.name)
    private readonly depositModel: Model<DepositDocument>,
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    private readonly assignments: UserTagAssignmentsService,
  ) {}

  async evaluateUser(userId: string): Promise<EvaluationResult> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      return {
        userId,
        previousTagId: null,
        assignedTagId: null,
        upgraded: false,
      };
    }

    const previousTagId = user.tag ? user.tag.toString() : null;
    const currentRank = await this.getCurrentRank(user);

    const tags = await this.tagModel
      .find({ isActive: true })
      .sort({ rank: -1 });

    let eligibleTag: UserTagDocument | null = null;
    for (const tag of tags) {
      const sum = await this.sumTransactionsInWindow(
        user._id as Types.ObjectId,
        tag.thresholdPeriod,
      );
      if (sum >= tag.thresholdAmount) {
        eligibleTag = tag;
        break;
      }
    }

    if (!eligibleTag) {
      return {
        userId,
        previousTagId,
        assignedTagId: previousTagId,
        upgraded: false,
      };
    }

    if (eligibleTag.rank <= currentRank) {
      return {
        userId,
        previousTagId,
        assignedTagId: previousTagId,
        upgraded: false,
      };
    }

    const assigned = await this.assignments.autoAssign(
      userId,
      (eligibleTag._id as Types.ObjectId).toString(),
    );

    this.logger.log(
      `Auto-upgraded user ${userId} from rank ${currentRank} to "${eligibleTag.name}" (rank ${eligibleTag.rank})`,
    );

    return {
      userId,
      previousTagId,
      assignedTagId: assigned.tag?.id ?? null,
      upgraded: true,
    };
  }

  private async getCurrentRank(user: UserDocument): Promise<number> {
    if (!user.tag) return 0;
    const tag = await this.tagModel.findById(user.tag);
    return tag ? tag.rank : 0;
  }

  private async sumTransactionsInWindow(
    userId: Types.ObjectId,
    period: ThresholdPeriod,
  ): Promise<number> {
    const since = this.windowStart(period);

    const [depositAgg, withdrawalAgg] = await Promise.all([
      this.depositModel.aggregate<{ total: number }>([
        { $match: { userId, timestamp: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.withdrawalModel.aggregate<{ total: number }>([
        {
          $match: {
            userId,
            status: WithdrawalStatus.Paid,
            createdAt: { $gte: since },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const depositSum = depositAgg[0]?.total ?? 0;
    const withdrawalSum = withdrawalAgg[0]?.total ?? 0;
    return depositSum + withdrawalSum;
  }

  private windowStart(period: ThresholdPeriod): Date {
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    switch (period) {
      case ThresholdPeriod.Day:
        return new Date(now - msPerDay);
      case ThresholdPeriod.Week:
        return new Date(now - 7 * msPerDay);
      case ThresholdPeriod.Month:
        return new Date(now - 30 * msPerDay);
    }
  }
}

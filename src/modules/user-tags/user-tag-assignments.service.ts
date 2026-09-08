import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  UserTag,
  UserTagDocument,
  ThresholdPeriod,
} from './schemas/user-tag.schema';
import {
  UserTagHistory,
  UserTagHistoryDocument,
  TagChangeSource,
} from './schemas/user-tag-history.schema';

export interface UserTagAssignmentResponse {
  userId: string;
  tag: {
    id: string;
    name: string;
    rank: number;
  } | null;
  assignedAt: string | null;
  assignedBy: string | null;
  source: 'auto' | 'manual' | null;
}

export interface UserTagDetailedResponse {
  userId: string;
  tag: {
    id: string;
    name: string;
    rank: number;
    thresholdAmount: number;
    thresholdPeriod: ThresholdPeriod;
    color: string | null;
    benefitInr: number;
    isActive: boolean;
  } | null;
  assignedAt: string | null;
  source: 'auto' | 'manual' | null;
}

export interface UserTagHistoryEntry {
  id: string;
  userId: string;
  fromTagId: string | null;
  toTagId: string | null;
  source: TagChangeSource;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
}

@Injectable()
export class UserTagAssignmentsService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(UserTag.name)
    private readonly tagModel: Model<UserTagDocument>,
    @InjectModel(UserTagHistory.name)
    private readonly historyModel: Model<UserTagHistoryDocument>,
  ) {}

  async manuallyAssign(
    userId: string,
    tagId: string,
    actorId: string,
    reason?: string,
  ): Promise<UserTagAssignmentResponse> {
    const user = await this.findUserOrFail(userId);
    const tag = await this.findTagOrFail(tagId);
    if (!tag.isActive) {
      throw new BadRequestException('Cannot assign an inactive tag');
    }

    const previousTagId = user.tag;

    user.tag = tag._id as Types.ObjectId;
    user.tagAssignedAt = new Date();
    user.tagAssignedBy = new Types.ObjectId(actorId);
    user.tagAssignmentSource = 'manual';
    await user.save();

    await this.historyModel.create({
      userId: user._id,
      fromTag: previousTagId,
      toTag: tag._id,
      source: 'manual',
      actorId: new Types.ObjectId(actorId),
      reason: reason ?? null,
    });

    return this.toResponse(user, tag);
  }

  async manuallyRemove(
    userId: string,
    actorId: string,
    reason?: string,
  ): Promise<UserTagAssignmentResponse> {
    const user = await this.findUserOrFail(userId);
    if (!user.tag) {
      throw new BadRequestException('User has no tag to remove');
    }

    const previousTagId = user.tag;

    user.tag = null;
    user.tagAssignedAt = null;
    user.tagAssignedBy = null;
    user.tagAssignmentSource = null;
    await user.save();

    await this.historyModel.create({
      userId: user._id,
      fromTag: previousTagId,
      toTag: null,
      source: 'manual',
      actorId: new Types.ObjectId(actorId),
      reason: reason ?? null,
    });

    return this.toResponse(user, null);
  }

  async autoAssign(
    userId: string,
    tagId: string,
  ): Promise<UserTagAssignmentResponse> {
    const user = await this.findUserOrFail(userId);
    const tag = await this.findTagOrFail(tagId);

    const tagObjectId = tag._id as Types.ObjectId;
    if (user.tag && user.tag.equals(tagObjectId)) {
      return this.toResponse(user, tag);
    }

    const previousTagId = user.tag;

    user.tag = tagObjectId;
    user.tagAssignedAt = new Date();
    user.tagAssignedBy = null;
    user.tagAssignmentSource = 'auto';
    await user.save();

    await this.historyModel.create({
      userId: user._id,
      fromTag: previousTagId,
      toTag: tagObjectId,
      source: 'auto',
      actorId: null,
      reason: null,
    });

    return this.toResponse(user, tag);
  }

  async getCurrentTag(userId: string): Promise<UserTagAssignmentResponse> {
    const user = await this.findUserOrFail(userId);
    const tag = user.tag
      ? await this.tagModel.findById(user.tag)
      : null;
    return this.toResponse(user, tag);
  }

  async getCurrentTagDetailed(
    userId: string,
  ): Promise<UserTagDetailedResponse> {
    const user = await this.findUserOrFail(userId);
    const tag = user.tag
      ? await this.tagModel.findById(user.tag)
      : null;
    return {
      userId: (user._id as Types.ObjectId).toString(),
      tag: tag
        ? {
            id: (tag._id as Types.ObjectId).toString(),
            name: tag.name,
            rank: tag.rank,
            thresholdAmount: tag.thresholdAmount,
            thresholdPeriod: tag.thresholdPeriod,
            color: tag.color ?? null,
            benefitInr: tag.benefitInr ?? 0,
            isActive: tag.isActive,
          }
        : null,
      assignedAt: user.tagAssignedAt
        ? user.tagAssignedAt.toISOString()
        : null,
      source: user.tagAssignmentSource,
    };
  }

  async listHistory(userId: string): Promise<UserTagHistoryEntry[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const docs = await this.historyModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 });

    return docs.map((d) => {
      const ts = d as unknown as { createdAt?: Date };
      return {
        id: (d._id as Types.ObjectId).toString(),
        userId: d.userId.toString(),
        fromTagId: d.fromTag ? d.fromTag.toString() : null,
        toTagId: d.toTag ? d.toTag.toString() : null,
        source: d.source,
        actorId: d.actorId ? d.actorId.toString() : null,
        reason: d.reason ?? null,
        createdAt: ts.createdAt
          ? ts.createdAt.toISOString()
          : new Date().toISOString(),
      };
    });
  }

  private async findUserOrFail(userId: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async findTagOrFail(tagId: string): Promise<UserTagDocument> {
    if (!Types.ObjectId.isValid(tagId)) {
      throw new BadRequestException('Invalid tagId');
    }
    const tag = await this.tagModel.findById(tagId);
    if (!tag) throw new NotFoundException('Tag not found');
    return tag;
  }

  private toResponse(
    user: UserDocument,
    tag: UserTagDocument | null,
  ): UserTagAssignmentResponse {
    return {
      userId: (user._id as Types.ObjectId).toString(),
      tag: tag
        ? {
            id: (tag._id as Types.ObjectId).toString(),
            name: tag.name,
            rank: tag.rank,
          }
        : null,
      assignedAt: user.tagAssignedAt
        ? user.tagAssignedAt.toISOString()
        : null,
      assignedBy: user.tagAssignedBy
        ? user.tagAssignedBy.toString()
        : null,
      source: user.tagAssignmentSource,
    };
  }
}

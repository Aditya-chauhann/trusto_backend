import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserTag,
  UserTagDocument,
  ThresholdPeriod,
} from './schemas/user-tag.schema';
import { CreateUserTagDto } from './dto/create-user-tag.dto';
import { UpdateUserTagDto } from './dto/update-user-tag.dto';

export interface UserTagResponse {
  id: string;
  name: string;
  rank: number;
  thresholdAmount: number;
  thresholdPeriod: ThresholdPeriod;
  isActive: boolean;
  color: string | null;
  benefitInr: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_TAGS: Array<{
  name: string;
  rank: number;
  thresholdAmount: number;
  thresholdPeriod: ThresholdPeriod;
  color: string;
}> = [
  {
    name: 'Silver',
    rank: 1,
    thresholdAmount: 1000,
    thresholdPeriod: ThresholdPeriod.Month,
    color: '#C0C0C0',
  },
  {
    name: 'Gold',
    rank: 2,
    thresholdAmount: 5000,
    thresholdPeriod: ThresholdPeriod.Month,
    color: '#FFD700',
  },
  {
    name: 'Diamond',
    rank: 3,
    thresholdAmount: 10000,
    thresholdPeriod: ThresholdPeriod.Month,
    color: '#B9F2FF',
  },
];

@Injectable()
export class UserTagsService implements OnModuleInit {
  private readonly logger = new Logger(UserTagsService.name);

  constructor(
    @InjectModel(UserTag.name)
    private readonly tagModel: Model<UserTagDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const seed of DEFAULT_TAGS) {
      const existing = await this.tagModel.findOne({
        name: new RegExp(`^${seed.name}$`, 'i'),
      });

      if (existing) {
        if (!existing.isDefault) {
          existing.isDefault = true;
          await existing.save();
          this.logger.log(`Marked existing tag "${existing.name}" as default`);
        }
        continue;
      }

      const rankTaken = await this.tagModel.findOne({ rank: seed.rank });
      if (rankTaken) {
        this.logger.warn(
          `Skipping seed for "${seed.name}": rank ${seed.rank} already in use by "${rankTaken.name}"`,
        );
        continue;
      }

      await this.tagModel.create({
        name: seed.name,
        rank: seed.rank,
        thresholdAmount: seed.thresholdAmount,
        thresholdPeriod: seed.thresholdPeriod,
        isActive: true,
        color: seed.color,
        isDefault: true,
      });
      this.logger.log(`Seeded default tag "${seed.name}"`);
    }
  }

  async create(dto: CreateUserTagDto): Promise<UserTagResponse> {
    await this.ensureNameAvailable(dto.name);
    await this.ensureRankAvailable(dto.rank);
    await this.ensureThresholdOrdering(dto.rank, dto.thresholdAmount);

    const created = await this.tagModel.create({
      name: dto.name.trim(),
      rank: dto.rank,
      thresholdAmount: dto.thresholdAmount,
      thresholdPeriod: dto.thresholdPeriod,
      isActive: dto.isActive ?? true,
      color: dto.color ?? null,
      benefitInr: dto.benefitInr ?? 0,
    });
    return this.toResponse(created);
  }

  async list(): Promise<UserTagResponse[]> {
    const docs = await this.tagModel.find().sort({ rank: 1 });
    return docs.map((d) => this.toResponse(d));
  }

  async listActive(): Promise<UserTagResponse[]> {
    const docs = await this.tagModel
      .find({ isActive: true })
      .sort({ rank: 1 });
    return docs.map((d) => this.toResponse(d));
  }

  async getById(id: string): Promise<UserTagResponse> {
    return this.toResponse(await this.findOrFail(id));
  }

  async update(id: string, dto: UpdateUserTagDto): Promise<UserTagResponse> {
    const doc = await this.findOrFail(id);

    if (dto.name !== undefined && dto.name.trim() !== doc.name) {
      if (doc.isDefault) {
        throw new BadRequestException(
          `"${doc.name}" is a default tag and cannot be renamed`,
        );
      }
      await this.ensureNameAvailable(dto.name, id);
      doc.name = dto.name.trim();
    }
    if (dto.rank !== undefined && dto.rank !== doc.rank) {
      await this.ensureRankAvailable(dto.rank, id);
      doc.rank = dto.rank;
    }
    if (dto.thresholdAmount !== undefined) {
      doc.thresholdAmount = dto.thresholdAmount;
    }
    if (dto.thresholdPeriod !== undefined) {
      doc.thresholdPeriod = dto.thresholdPeriod;
    }
    if (dto.isActive !== undefined) {
      doc.isActive = dto.isActive;
    }
    if (dto.color !== undefined) {
      doc.color = dto.color || null;
    }
    if (dto.benefitInr !== undefined) {
      doc.benefitInr = dto.benefitInr;
    }

    await this.ensureThresholdOrdering(doc.rank, doc.thresholdAmount, id);
    await doc.save();
    return this.toResponse(doc);
  }

  async setActive(id: string, isActive: boolean): Promise<UserTagResponse> {
    const doc = await this.findOrFail(id);
    if (doc.isActive === isActive) {
      return this.toResponse(doc);
    }
    doc.isActive = isActive;
    await doc.save();
    this.logger.log(
      `Tag "${doc.name}" ${isActive ? 'enabled' : 'disabled'}`,
    );
    return this.toResponse(doc);
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findOrFail(id);
    if (doc.isDefault) {
      throw new BadRequestException(
        `"${doc.name}" is a default tag and cannot be deleted`,
      );
    }
    await doc.deleteOne();
  }

  private async findOrFail(id: string): Promise<UserTagDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid tag id');
    }
    const doc = await this.tagModel.findById(id);
    if (!doc) throw new NotFoundException('Tag not found');
    return doc;
  }

  private async ensureNameAvailable(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const normalized = name.trim();
    const query: Record<string, unknown> = {
      name: new RegExp(`^${normalized}$`, 'i'),
    };
    if (excludeId) query._id = { $ne: new Types.ObjectId(excludeId) };
    const existing = await this.tagModel.findOne(query);
    if (existing) {
      throw new ConflictException(`Tag with name "${normalized}" already exists`);
    }
  }

  private async ensureRankAvailable(
    rank: number,
    excludeId?: string,
  ): Promise<void> {
    const query: Record<string, unknown> = { rank };
    if (excludeId) query._id = { $ne: new Types.ObjectId(excludeId) };
    const existing = await this.tagModel.findOne(query);
    if (existing) {
      throw new ConflictException(`Tag with rank ${rank} already exists`);
    }
  }

  private async ensureThresholdOrdering(
    rank: number,
    thresholdAmount: number,
    excludeId?: string,
  ): Promise<void> {
    const filter: Record<string, unknown> = excludeId
      ? { _id: { $ne: new Types.ObjectId(excludeId) } }
      : {};
    const others = await this.tagModel.find(filter);

    for (const other of others) {
      if (other.rank < rank && other.thresholdAmount >= thresholdAmount) {
        throw new BadRequestException(
          `Threshold ${thresholdAmount} must be greater than lower-tier "${other.name}" (${other.thresholdAmount})`,
        );
      }
      if (other.rank > rank && other.thresholdAmount <= thresholdAmount) {
        throw new BadRequestException(
          `Threshold ${thresholdAmount} must be less than higher-tier "${other.name}" (${other.thresholdAmount})`,
        );
      }
    }
  }

  private toResponse(d: UserTagDocument): UserTagResponse {
    const ts = d as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (d._id as Types.ObjectId).toString(),
      name: d.name,
      rank: d.rank,
      thresholdAmount: d.thresholdAmount,
      thresholdPeriod: d.thresholdPeriod,
      isActive: d.isActive,
      color: d.color ?? null,
      benefitInr: d.benefitInr ?? 0,
      isDefault: d.isDefault,
      createdAt: ts.createdAt
        ? ts.createdAt.toISOString()
        : new Date().toISOString(),
      updatedAt: ts.updatedAt
        ? ts.updatedAt.toISOString()
        : new Date().toISOString(),
    };
  }
}

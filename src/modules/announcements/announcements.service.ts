import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Announcement,
  AnnouncementDocument,
} from './schemas/announcement.schema';
import {
  NotificationSettings,
  NotificationSettingsDocument,
} from './schemas/notification-settings.schema';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    @InjectModel(Announcement.name)
    private readonly announcementModel: Model<AnnouncementDocument>,
    @InjectModel(NotificationSettings.name)
    private readonly settingsModel: Model<NotificationSettingsDocument>,
  ) {}

  async listAll(): Promise<AnnouncementDocument[]> {
    return this.announcementModel.find().sort({ createdAt: -1 }).exec();
  }

  async listActiveForScope(scope: 'users' | 'staff'): Promise<AnnouncementDocument[]> {
    const now = new Date();
    return this.announcementModel
      .find({
        isActive: true,
        startDate: { $lte: now },
        endDate: { $gte: now },
        targetAudience: { $in: ['all', scope] },
      })
      .sort({ startDate: -1 })
      .exec();
  }

  async getById(id: string): Promise<AnnouncementDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid announcement ID');
    }
    const item = await this.announcementModel.findById(id).exec();
    if (!item) throw new NotFoundException('Announcement not found');
    return item;
  }

  async create(
    adminId: string,
    dto: CreateAnnouncementDto,
  ): Promise<AnnouncementDocument> {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid start or end date');
    }
    if (end <= start) {
      throw new BadRequestException('End date must be after start date');
    }

    return this.announcementModel.create({
      title: dto.title.trim(),
      content: dto.content.trim(),
      link: dto.link ? dto.link.trim() : null,
      targetAudience: dto.targetAudience,
      type: dto.type,
      startDate: start,
      endDate: end,
      isActive: dto.isActive ?? true,
      createdBy: new Types.ObjectId(adminId),
    });
  }

  async update(
    id: string,
    dto: UpdateAnnouncementDto,
  ): Promise<AnnouncementDocument> {
    const item = await this.getById(id);

    if (dto.title !== undefined) item.title = dto.title.trim();
    if (dto.content !== undefined) item.content = dto.content.trim();
    if (dto.link !== undefined) item.link = dto.link ? dto.link.trim() : null;
    if (dto.targetAudience !== undefined)
      item.targetAudience = dto.targetAudience;
    if (dto.type !== undefined) item.type = dto.type;
    if (dto.isActive !== undefined) item.isActive = dto.isActive;

    if (dto.startDate !== undefined) {
      const s = new Date(dto.startDate);
      if (isNaN(s.getTime())) throw new BadRequestException('Invalid start date');
      item.startDate = s;
    }
    if (dto.endDate !== undefined) {
      const e = new Date(dto.endDate);
      if (isNaN(e.getTime())) throw new BadRequestException('Invalid end date');
      item.endDate = e;
    }

    if (item.endDate <= item.startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    return item.save();
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const item = await this.getById(id);
    await item.deleteOne();
    return { success: true };
  }

  // --- Notification Settings ---

  async getSettings(): Promise<NotificationSettingsDocument> {
    let settings = await this.settingsModel.findOne().exec();
    if (!settings) {
      settings = await this.settingsModel.create({});
    }
    return settings;
  }

  async updateSettings(
    dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingsDocument> {
    const settings = await this.getSettings();
    if (dto.depositNotificationsEnabled !== undefined)
      settings.depositNotificationsEnabled = dto.depositNotificationsEnabled;
    if (dto.withdrawalNotificationsEnabled !== undefined)
      settings.withdrawalNotificationsEnabled = dto.withdrawalNotificationsEnabled;
    if (dto.disputeNotificationsEnabled !== undefined)
      settings.disputeNotificationsEnabled = dto.disputeNotificationsEnabled;
    if (dto.ticketNotificationsEnabled !== undefined)
      settings.ticketNotificationsEnabled = dto.ticketNotificationsEnabled;
    if (dto.telegramNotificationsEnabled !== undefined)
      settings.telegramNotificationsEnabled = dto.telegramNotificationsEnabled;
    if (dto.emailNotificationsEnabled !== undefined)
      settings.emailNotificationsEnabled = dto.emailNotificationsEnabled;
    if (dto.systemAlertsEnabled !== undefined)
      settings.systemAlertsEnabled = dto.systemAlertsEnabled;

    return settings.save();
  }
}

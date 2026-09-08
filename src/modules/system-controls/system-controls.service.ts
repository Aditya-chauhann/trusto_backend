import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SYSTEM_CONTROLS_KEY,
  SystemControls,
  SystemControlsDocument,
} from './schemas/system-controls.schema';
import { UpdateSystemControlsDto } from './dto/update-system-controls.dto';

export interface SystemControlsResponse {
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  depositsDisabledReason: string;
  withdrawalsDisabledReason: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceEta: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByType: 'user' | 'staff' | null;
}

export interface PublicSystemControlsResponse {
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  depositsDisabledReason: string;
  withdrawalsDisabledReason: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceEta: string | null;
}

/** Just the maintenance slice — what GET /health embeds on every poll. */
export interface MaintenanceState {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceEta: string | null;
}

@Injectable()
export class SystemControlsService {
  constructor(
    @InjectModel(SystemControls.name)
    private readonly controlsModel: Model<SystemControlsDocument>,
  ) {}

  async get(): Promise<SystemControlsResponse> {
    const doc = await this.loadOrSeed();
    return this.toResponse(doc);
  }

  async getPublic(): Promise<PublicSystemControlsResponse> {
    const doc = await this.loadOrSeed();
    return {
      depositsEnabled: doc.depositsEnabled,
      withdrawalsEnabled: doc.withdrawalsEnabled,
      depositsDisabledReason: doc.depositsDisabledReason ?? '',
      withdrawalsDisabledReason: doc.withdrawalsDisabledReason ?? '',
      ...this.toMaintenanceState(doc),
    };
  }

  /**
   * Maintenance flags only. Read on every /health poll, so it must stay a
   * single indexed lookup — never widen this into extra queries.
   */
  async getMaintenanceState(): Promise<MaintenanceState> {
    const doc = await this.loadOrSeed();
    return this.toMaintenanceState(doc);
  }

  async update(
    dto: UpdateSystemControlsDto,
    actor: { id: string; type: 'user' | 'staff' },
  ): Promise<SystemControlsResponse> {
    if (
      dto.depositsEnabled === undefined &&
      dto.withdrawalsEnabled === undefined &&
      dto.depositsDisabledReason === undefined &&
      dto.withdrawalsDisabledReason === undefined &&
      dto.maintenanceMode === undefined &&
      dto.maintenanceMessage === undefined &&
      dto.maintenanceEta === undefined
    ) {
      throw new BadRequestException('No fields to update');
    }

    const doc = await this.loadOrSeed();
    if (dto.depositsEnabled !== undefined) {
      doc.depositsEnabled = dto.depositsEnabled;
      if (dto.depositsEnabled === true && dto.depositsDisabledReason === undefined) {
        doc.depositsDisabledReason = '';
      }
    }
    if (dto.withdrawalsEnabled !== undefined) {
      doc.withdrawalsEnabled = dto.withdrawalsEnabled;
      if (dto.withdrawalsEnabled === true && dto.withdrawalsDisabledReason === undefined) {
        doc.withdrawalsDisabledReason = '';
      }
    }
    if (dto.depositsDisabledReason !== undefined) {
      doc.depositsDisabledReason = dto.depositsDisabledReason.trim();
    }
    if (dto.withdrawalsDisabledReason !== undefined) {
      doc.withdrawalsDisabledReason = dto.withdrawalsDisabledReason.trim();
    }
    if (dto.maintenanceMode !== undefined) {
      doc.maintenanceMode = dto.maintenanceMode;
      // Leaving maintenance clears the banner copy unless it was set in the
      // same request, so stale "back in 2 hours" text can't outlive the window.
      if (dto.maintenanceMode === false) {
        if (dto.maintenanceMessage === undefined) doc.maintenanceMessage = '';
        if (dto.maintenanceEta === undefined) doc.maintenanceEta = null;
      }
    }
    if (dto.maintenanceMessage !== undefined) {
      doc.maintenanceMessage = dto.maintenanceMessage.trim();
    }
    if (dto.maintenanceEta !== undefined) {
      doc.maintenanceEta = dto.maintenanceEta
        ? new Date(dto.maintenanceEta)
        : null;
    }
    doc.updatedBy = Types.ObjectId.isValid(actor.id)
      ? new Types.ObjectId(actor.id)
      : null;
    doc.updatedByType = actor.type;
    await doc.save();
    return this.toResponse(doc);
  }

  private async loadOrSeed(): Promise<SystemControlsDocument> {
    let doc = await this.controlsModel.findOne({ key: SYSTEM_CONTROLS_KEY });
    if (!doc) {
      doc = await this.controlsModel.create({
        key: SYSTEM_CONTROLS_KEY,
        depositsEnabled: true,
        withdrawalsEnabled: true,
        depositsDisabledReason: '',
        withdrawalsDisabledReason: '',
      });
    }
    return doc;
  }

  private toMaintenanceState(doc: SystemControlsDocument): MaintenanceState {
    return {
      maintenanceMode: doc.maintenanceMode ?? false,
      maintenanceMessage: doc.maintenanceMessage ?? '',
      maintenanceEta: doc.maintenanceEta
        ? doc.maintenanceEta.toISOString()
        : null,
    };
  }

  private toResponse(doc: SystemControlsDocument): SystemControlsResponse {
    const ts = doc as unknown as { updatedAt?: Date };
    return {
      depositsEnabled: doc.depositsEnabled,
      withdrawalsEnabled: doc.withdrawalsEnabled,
      depositsDisabledReason: doc.depositsDisabledReason ?? '',
      withdrawalsDisabledReason: doc.withdrawalsDisabledReason ?? '',
      ...this.toMaintenanceState(doc),
      updatedAt: ts.updatedAt ? ts.updatedAt.toISOString() : null,
      updatedBy: doc.updatedBy ? doc.updatedBy.toString() : null,
      updatedByType: doc.updatedByType,
    };
  }
}

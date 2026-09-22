import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PricingSettings,
  PricingSettingsDocument,
  PRICING_SETTINGS_KEY,
} from './schemas/pricing-settings.schema';
import {
  UserPricing,
  UserPricingDocument,
} from './schemas/user-pricing.schema';
import {
  PricingHistory,
  PricingHistoryDocument,
  PricingHistoryAction,
  PricingHistoryScope,
  PricingField,
  PricingChange,
} from './schemas/pricing-history.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

const DEFAULT_GLOBAL = {
  usdtPrice: 1,
  inrPrice: 82.5,
  feePercent: 0.015,
  bankFee: 0,
  cryptoFee: 0,
  smartToggleMinUsdt: 100,
  enableDeposits: true,
  enableWithdrawals: true,
  enableBankWithdrawal: true,
  enableUpiWithdrawal: true,
  enableSmartUpiWithdrawal: true,
  enableCryptoWithdrawal: true,
  enableSweep: process.env.SWEEP_ENABLED === 'true',
  sweepDelayMinutes: Number(process.env.SWEEP_DELAY_MINUTES) || 0,
};

export interface PricingValues {
  usdtPrice: number;
  inrPrice: number;
  upiInrPrice: number;
  feePercent: number;
  bankFee?: number;
  cryptoFee?: number;
  smartToggleMinUsdt?: number;
  enableDeposits?: boolean;
  enableWithdrawals?: boolean;
  enableBankWithdrawal?: boolean;
  enableUpiWithdrawal?: boolean;
  enableSmartUpiWithdrawal?: boolean;
  enableCryptoWithdrawal?: boolean;
  enableSweep?: boolean;
  sweepDelayMinutes?: number;
}

export interface GlobalPricingResponse extends PricingValues {
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByType: 'user' | 'staff' | null;
  bankFee: number;
  cryptoFee: number;
  smartToggleMinUsdt: number;
  enableDeposits: boolean;
  enableWithdrawals: boolean;
  enableBankWithdrawal: boolean;
  enableUpiWithdrawal: boolean;
  enableSmartUpiWithdrawal: boolean;
  enableCryptoWithdrawal: boolean;
  enableSweep: boolean;
  sweepDelayMinutes: number;
}

export interface UserOverrideValues {
  usdtPrice: number | null;
  inrPrice: number | null;
  upiInrPrice: number | null;
  feePercent: number | null;
  bankFee?: number | null;
  cryptoFee?: number | null;
}

export interface UserPricingResponse {
  userId: string;
  override: UserOverrideValues | null;
  effective: PricingValues;
  updatedAt: string | null;
  setBy: string | null;
  setByType: 'user' | 'staff' | null;
}

export interface UpdateGlobalInput {
  usdtPrice?: number;
  inrPrice?: number;
  upiInrPrice?: number;
  feePercent?: number;
  bankFee?: number;
  cryptoFee?: number;
  smartToggleMinUsdt?: number;
  enableDeposits?: boolean;
  enableWithdrawals?: boolean;
  enableBankWithdrawal?: boolean;
  enableUpiWithdrawal?: boolean;
  enableSmartUpiWithdrawal?: boolean;
  enableCryptoWithdrawal?: boolean;
  enableSweep?: boolean;
  sweepDelayMinutes?: number;
}

export interface UpdateUserOverrideInput {
  usdtPrice?: number | null;
  inrPrice?: number | null;
  upiInrPrice?: number | null;
  feePercent?: number | null;
}

export interface Actor {
  id: string;
  type: 'user' | 'staff';
}

const GLOBAL_PRICING_FIELDS: PricingField[] = [
  'usdtPrice',
  'inrPrice',
  'upiInrPrice',
  'feePercent',
  'bankFee',
  'cryptoFee',
  'smartToggleMinUsdt',
  'enableDeposits',
  'enableWithdrawals',
  'enableBankWithdrawal',
  'enableUpiWithdrawal',
  'enableSmartUpiWithdrawal',
  'enableCryptoWithdrawal',
  'enableSweep',
  'sweepDelayMinutes',
];

const USER_OVERRIDE_FIELDS: PricingField[] = [
  'usdtPrice',
  'inrPrice',
  'upiInrPrice',
  'feePercent',
];

@Injectable()
export class PricingService {
  constructor(
    @InjectModel(PricingSettings.name)
    private readonly settingsModel: Model<PricingSettingsDocument>,
    @InjectModel(UserPricing.name)
    private readonly userPricingModel: Model<UserPricingDocument>,
    @InjectModel(PricingHistory.name)
    private readonly historyModel: Model<PricingHistoryDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async getGlobal(): Promise<GlobalPricingResponse> {
    const doc = await this.loadOrSeedGlobal();
    return this.toGlobalResponse(doc);
  }

  async updateGlobal(
    input: UpdateGlobalInput,
    actor: Actor,
  ): Promise<GlobalPricingResponse> {
    validateGlobalInput(input);
    const hasAnyField = GLOBAL_PRICING_FIELDS.some((f) => (input as Record<string, any>)[f] !== undefined);
    if (!hasAnyField) {
      throw new BadRequestException('No fields to update');
    }

    const doc = await this.loadOrSeedGlobal();
    const changes: PricingChange[] = [];

    for (const field of GLOBAL_PRICING_FIELDS) {
      const next = (input as Record<string, any>)[field];
      if (next === undefined) continue;
      const prev = (doc as Record<string, any>)[field];
      if (next === prev) continue;
      (doc as Record<string, any>)[field] = next;
      changes.push({ field, oldValue: prev ?? null, newValue: next });
    }

    if (changes.length === 0) {
      return this.toGlobalResponse(doc);
    }

    doc.updatedBy = new Types.ObjectId(actor.id);
    doc.updatedByType = actor.type;
    await doc.save();

    await this.historyModel.create({
      scope: PricingHistoryScope.Global,
      action: PricingHistoryAction.Update,
      userId: null,
      changes,
      changedBy: new Types.ObjectId(actor.id),
      changedByType: actor.type,
    });

    return this.toGlobalResponse(doc);
  }

  async getUserPricing(userId: string): Promise<UserPricingResponse> {
    await this.assertUserExists(userId);
    const [global, override] = await Promise.all([
      this.loadOrSeedGlobal(),
      this.userPricingModel.findOne({ userId: new Types.ObjectId(userId) }),
    ]);
    return this.toUserResponse(userId, global, override);
  }

  async setUserPricing(
    userId: string,
    input: UpdateUserOverrideInput,
    actor: Actor,
  ): Promise<UserPricingResponse> {
    if (
      input.usdtPrice === undefined &&
      input.inrPrice === undefined &&
      input.upiInrPrice === undefined &&
      input.feePercent === undefined
    ) {
      throw new BadRequestException('No fields to update');
    }
    validateOverrideInput(input);
    await this.assertUserExists(userId);

    const uid = new Types.ObjectId(userId);
    const existing = await this.userPricingModel.findOne({ userId: uid });
    const changes: PricingChange[] = [];

    if (existing) {
      for (const field of USER_OVERRIDE_FIELDS) {
        if (!(field in input)) continue;
        const next = (input as Record<string, any>)[field] ?? null;
        const prev = (existing as Record<string, any>)[field] ?? null;
        if (next === prev) continue;
        (existing as Record<string, any>)[field] = next;
        changes.push({ field, oldValue: prev, newValue: next });
      }
      const allCleared = USER_OVERRIDE_FIELDS.every(
        (f) => (existing as Record<string, any>)[f] === null || (existing as Record<string, any>)[f] === undefined,
      );
      if (allCleared) {
        await existing.deleteOne();
        if (changes.length > 0) {
          await this.historyModel.create({
            scope: PricingHistoryScope.User,
            action: PricingHistoryAction.Clear,
            userId: uid,
            changes,
            changedBy: new Types.ObjectId(actor.id),
            changedByType: actor.type,
          });
        }
        const global = await this.loadOrSeedGlobal();
        return this.toUserResponse(userId, global, null);
      }
      if (changes.length === 0) {
        const global = await this.loadOrSeedGlobal();
        return this.toUserResponse(userId, global, existing);
      }
      existing.setBy = new Types.ObjectId(actor.id);
      existing.setByType = actor.type;
      await existing.save();
    } else {
      const created = await this.userPricingModel.create({
        userId: uid,
        usdtPrice: input.usdtPrice ?? null,
        inrPrice: input.inrPrice ?? null,
        upiInrPrice: input.upiInrPrice ?? null,
        feePercent: input.feePercent ?? null,
        setBy: new Types.ObjectId(actor.id),
        setByType: actor.type,
      });
      for (const field of USER_OVERRIDE_FIELDS) {
        if (!(field in input)) continue;
        const value = (input as Record<string, any>)[field];
        if (value === null || value === undefined) continue;
        changes.push({ field, oldValue: null, newValue: value });
      }
      if (changes.length > 0) {
        await this.historyModel.create({
          scope: PricingHistoryScope.User,
          action: PricingHistoryAction.Update,
          userId: uid,
          changes,
          changedBy: new Types.ObjectId(actor.id),
          changedByType: actor.type,
        });
      }
      const global = await this.loadOrSeedGlobal();
      return this.toUserResponse(userId, global, created);
    }

    await this.historyModel.create({
      scope: PricingHistoryScope.User,
      action: PricingHistoryAction.Update,
      userId: uid,
      changes,
      changedBy: new Types.ObjectId(actor.id),
      changedByType: actor.type,
    });

    const global = await this.loadOrSeedGlobal();
    const fresh = await this.userPricingModel.findOne({ userId: uid });
    return this.toUserResponse(userId, global, fresh);
  }

  async clearUserPricing(
    userId: string,
    actor: Actor,
  ): Promise<UserPricingResponse> {
    await this.assertUserExists(userId);
    const uid = new Types.ObjectId(userId);
    const existing = await this.userPricingModel.findOne({ userId: uid });
    if (!existing) {
      const global = await this.loadOrSeedGlobal();
      return this.toUserResponse(userId, global, null);
    }
    const changes: PricingChange[] = USER_OVERRIDE_FIELDS.filter(
      (f) => (existing as Record<string, any>)[f] !== null && (existing as Record<string, any>)[f] !== undefined,
    ).map((f) => ({ field: f, oldValue: (existing as Record<string, any>)[f], newValue: null }));
    await existing.deleteOne();
    if (changes.length > 0) {
      await this.historyModel.create({
        scope: PricingHistoryScope.User,
        action: PricingHistoryAction.Clear,
        userId: uid,
        changes,
        changedBy: new Types.ObjectId(actor.id),
        changedByType: actor.type,
      });
    }
    const global = await this.loadOrSeedGlobal();
    return this.toUserResponse(userId, global, null);
  }

  async listOverrides(
    page = 1,
    limit = 25,
  ): Promise<{
    items: UserPricingResponse[];
    total: number;
    page: number;
    limit: number;
  }> {
    const p = Math.max(page, 1);
    const l = Math.min(Math.max(limit, 1), 100);
    const [docs, total, global] = await Promise.all([
      this.userPricingModel
        .find()
        .sort({ updatedAt: -1 })
        .skip((p - 1) * l)
        .limit(l),
      this.userPricingModel.countDocuments(),
      this.loadOrSeedGlobal(),
    ]);
    return {
      items: docs.map((d) =>
        this.toUserResponse(d.userId.toString(), global, d),
      ),
      total,
      page: p,
      limit: l,
    };
  }

  async listHistory(opts: {
    scope?: PricingHistoryScope;
    userId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    items: ReturnType<typeof toHistoryResponse>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const p = Math.max(opts.page ?? 1, 1);
    const l = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    const filter: Record<string, unknown> = {};
    if (opts.scope) filter.scope = opts.scope;
    if (opts.userId) {
      if (!Types.ObjectId.isValid(opts.userId)) {
        throw new BadRequestException('Invalid userId');
      }
      filter.userId = new Types.ObjectId(opts.userId);
    }
    const [docs, total] = await Promise.all([
      this.historyModel
        .find(filter)
        .sort({ at: -1 })
        .skip((p - 1) * l)
        .limit(l),
      this.historyModel.countDocuments(filter),
    ]);
    return {
      items: docs.map(toHistoryResponse),
      total,
      page: p,
      limit: l,
    };
  }

  async getEffectiveForUser(userId: string): Promise<PricingValues> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const [global, override] = await Promise.all([
      this.loadOrSeedGlobal(),
      this.userPricingModel.findOne({ userId: new Types.ObjectId(userId) }),
    ]);
    return this.resolveEffective(global, override);
  }

  async getEffectiveForUserWithFlag(
    userId: string,
  ): Promise<PricingValues & { hasOverride: boolean }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const [global, override] = await Promise.all([
      this.loadOrSeedGlobal(),
      this.userPricingModel.findOne({ userId: new Types.ObjectId(userId) }),
    ]);
    const effective = this.resolveEffective(global, override);
    const hasOverride =
      override !== null &&
      (override.usdtPrice !== null ||
        override.inrPrice !== null ||
        override.upiInrPrice !== null ||
        override.feePercent !== null ||
        (override as any).bankFee != null ||
        (override as any).cryptoFee != null);
    return { ...effective, smartToggleMinUsdt: global.smartToggleMinUsdt ?? 100, hasOverride };
  }

  private resolveEffective(
    global: PricingSettingsDocument,
    override: UserPricingDocument | null,
  ): PricingValues {
    return {
      usdtPrice:
        override?.usdtPrice !== null && override?.usdtPrice !== undefined
          ? override.usdtPrice
          : global.usdtPrice,
      inrPrice:
        override?.inrPrice !== null && override?.inrPrice !== undefined
          ? override.inrPrice
          : global.inrPrice,
      upiInrPrice:
        override?.upiInrPrice !== null && override?.upiInrPrice !== undefined
          ? override.upiInrPrice
          : (global.upiInrPrice ?? global.inrPrice),
      feePercent:
        override?.feePercent !== null && override?.feePercent !== undefined
          ? override.feePercent
          : global.feePercent,
      bankFee:
        (override as any)?.bankFee !== null && (override as any)?.bankFee !== undefined
          ? (override as any).bankFee
          : (global.bankFee ?? 0),
      cryptoFee:
        (override as any)?.cryptoFee !== null && (override as any)?.cryptoFee !== undefined
          ? (override as any).cryptoFee
          : (global.cryptoFee ?? 0),
      enableDeposits: global.enableDeposits ?? true,
      enableWithdrawals: global.enableWithdrawals ?? true,
      enableBankWithdrawal: global.enableBankWithdrawal ?? true,
      enableUpiWithdrawal: global.enableUpiWithdrawal ?? true,
      enableSmartUpiWithdrawal: global.enableSmartUpiWithdrawal ?? true,
      enableCryptoWithdrawal: global.enableCryptoWithdrawal ?? true,
      enableSweep: global.enableSweep ?? (process.env.SWEEP_ENABLED === 'true'),
      sweepDelayMinutes: global.sweepDelayMinutes ?? 0,
    };
  }

  private async loadOrSeedGlobal(): Promise<PricingSettingsDocument> {
    const existing = await this.settingsModel.findOne({
      key: PRICING_SETTINGS_KEY,
    });
    if (existing) return existing;
    return this.settingsModel.create({
      key: PRICING_SETTINGS_KEY,
      usdtPrice: DEFAULT_GLOBAL.usdtPrice,
      inrPrice: DEFAULT_GLOBAL.inrPrice,
      feePercent: DEFAULT_GLOBAL.feePercent,
      bankFee: DEFAULT_GLOBAL.bankFee,
      cryptoFee: DEFAULT_GLOBAL.cryptoFee,
      enableDeposits: DEFAULT_GLOBAL.enableDeposits,
      enableWithdrawals: DEFAULT_GLOBAL.enableWithdrawals,
      enableBankWithdrawal: DEFAULT_GLOBAL.enableBankWithdrawal,
      enableUpiWithdrawal: DEFAULT_GLOBAL.enableUpiWithdrawal,
      enableSmartUpiWithdrawal: DEFAULT_GLOBAL.enableSmartUpiWithdrawal,
      enableCryptoWithdrawal: DEFAULT_GLOBAL.enableCryptoWithdrawal,
      enableSweep: DEFAULT_GLOBAL.enableSweep,
      sweepDelayMinutes: DEFAULT_GLOBAL.sweepDelayMinutes,
    });
  }

  private async assertUserExists(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const exists = await this.userModel.exists({ _id: userId });
    if (!exists) throw new NotFoundException('User not found');
  }

  private toGlobalResponse(
    doc: PricingSettingsDocument,
  ): GlobalPricingResponse {
    const ts = doc as unknown as { updatedAt?: Date };
    return {
      usdtPrice: doc.usdtPrice,
      inrPrice: doc.inrPrice,
      upiInrPrice: doc.upiInrPrice ?? doc.inrPrice,
      feePercent: doc.feePercent,
      bankFee: doc.bankFee ?? 0,
      cryptoFee: doc.cryptoFee ?? 0,
      smartToggleMinUsdt: doc.smartToggleMinUsdt ?? 100,
      enableDeposits: doc.enableDeposits ?? true,
      enableWithdrawals: doc.enableWithdrawals ?? true,
      enableBankWithdrawal: doc.enableBankWithdrawal ?? true,
      enableUpiWithdrawal: doc.enableUpiWithdrawal ?? true,
      enableSmartUpiWithdrawal: doc.enableSmartUpiWithdrawal ?? true,
      enableCryptoWithdrawal: doc.enableCryptoWithdrawal ?? true,
      enableSweep: doc.enableSweep ?? (process.env.SWEEP_ENABLED === 'true'),
      sweepDelayMinutes: doc.sweepDelayMinutes ?? 0,
      updatedAt: ts.updatedAt ? ts.updatedAt.toISOString() : null,
      updatedBy: doc.updatedBy ? doc.updatedBy.toString() : null,
      updatedByType: doc.updatedByType,
    };
  }

  async isSweepEnabled(): Promise<boolean> {
    const global = await this.loadOrSeedGlobal();
    return global.enableSweep ?? (process.env.SWEEP_ENABLED === 'true');
  }

  async getSweepDelayMinutes(): Promise<number> {
    const global = await this.loadOrSeedGlobal();
    return global.sweepDelayMinutes ?? 0;
  }

  async getSmartToggleMinUsdt(): Promise<number> {
    const global = await this.loadOrSeedGlobal();
    return global.smartToggleMinUsdt ?? 100;
  }

  private toUserResponse(
    userId: string,
    global: PricingSettingsDocument,
    override: UserPricingDocument | null,
  ): UserPricingResponse {
    const effective = this.resolveEffective(global, override);
    const ts = override as unknown as { updatedAt?: Date } | null;
    return {
      userId,
      override: override
        ? {
            usdtPrice: override.usdtPrice,
            inrPrice: override.inrPrice,
            upiInrPrice: override.upiInrPrice,
            feePercent: override.feePercent,
            bankFee: (override as any).bankFee ?? null,
            cryptoFee: (override as any).cryptoFee ?? null,
          }
        : null,
      effective,
      updatedAt: ts?.updatedAt ? ts.updatedAt.toISOString() : null,
      setBy: override?.setBy ? override.setBy.toString() : null,
      setByType: override?.setByType ?? null,
    };
  }
}

function validateGlobalInput(input: UpdateGlobalInput): void {
  if (input.usdtPrice !== undefined) assertPositive('usdtPrice', input.usdtPrice);
  if (input.inrPrice !== undefined) assertPositive('inrPrice', input.inrPrice);
  if (input.upiInrPrice !== undefined) assertPositive('upiInrPrice', input.upiInrPrice);
  if (input.feePercent !== undefined) assertFeePercent('feePercent', input.feePercent);
  if (input.bankFee !== undefined) assertFeePercent('bankFee', input.bankFee);
  if (input.cryptoFee !== undefined) assertFeePercent('cryptoFee', input.cryptoFee);
  if (input.smartToggleMinUsdt !== undefined) assertPositive('smartToggleMinUsdt', input.smartToggleMinUsdt);
  if (input.sweepDelayMinutes !== undefined) assertNonNegative('sweepDelayMinutes', input.sweepDelayMinutes);
}

function validateOverrideInput(input: UpdateUserOverrideInput): void {
  if (input.usdtPrice !== undefined && input.usdtPrice !== null) {
    assertPositive('usdtPrice', input.usdtPrice);
  }
  if (input.inrPrice !== undefined && input.inrPrice !== null) {
    assertPositive('inrPrice', input.inrPrice);
  }
  if (input.upiInrPrice !== undefined && input.upiInrPrice !== null) {
    assertPositive('upiInrPrice', input.upiInrPrice);
  }
  if (input.feePercent !== undefined && input.feePercent !== null) {
    assertFeePercent('feePercent', input.feePercent);
  }
}

function assertPositive(field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BadRequestException(`${field} must be a positive number`);
  }
}

function assertNonNegative(field: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException(`${field} must be a non-negative number`);
  }
}

function assertFeePercent(field: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new BadRequestException(
      `${field} must be a fraction in [0, 1) — e.g. 0.015 for 1.5%`,
    );
  }
}

function toHistoryResponse(doc: PricingHistoryDocument) {
  const at = (doc as unknown as { at?: Date }).at;
  return {
    id: (doc._id as Types.ObjectId).toString(),
    scope: doc.scope,
    action: doc.action,
    userId: doc.userId ? doc.userId.toString() : null,
    changes: doc.changes.map((c) => ({
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
    })),
    changedBy: doc.changedBy.toString(),
    changedByType: doc.changedByType,
    at: at ? at.toISOString() : null,
  };
}

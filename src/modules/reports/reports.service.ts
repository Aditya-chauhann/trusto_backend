import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Deposit,
  DepositDocument,
} from '../deposits/schemas/deposit.schema';
import {
  Withdrawal,
  WithdrawalDocument,
  WithdrawalStatus,
} from '../withdrawals/schemas/withdrawal.schema';
import {
  Ticket,
  TicketDocument,
} from '../tickets/schemas/ticket.schema';
import {
  UserTag,
  UserTagDocument,
} from '../user-tags/schemas/user-tag.schema';
import {
  PricingSettings,
  PricingSettingsDocument,
  PRICING_SETTINGS_KEY,
} from '../pricing/schemas/pricing-settings.schema';
import {
  UserPricing,
  UserPricingDocument,
} from '../pricing/schemas/user-pricing.schema';
import {
  StaffUser,
  StaffUserDocument,
} from '../staff/schemas/staff-user.schema';
import { XlsxColumn } from './xlsx.helper';

export interface ReportPayload {
  filename: string;
  sheetName: string;
  columns: XlsxColumn[];
  rows: Record<string, unknown>[];
}

interface DateRange {
  from?: Date;
  to?: Date;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Deposit.name)
    private readonly depositModel: Model<DepositDocument>,
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(UserTag.name)
    private readonly userTagModel: Model<UserTagDocument>,
    @InjectModel(PricingSettings.name)
    private readonly pricingModel: Model<PricingSettingsDocument>,
    @InjectModel(UserPricing.name)
    private readonly userPricingModel: Model<UserPricingDocument>,
    @InjectModel(StaffUser.name)
    private readonly staffModel: Model<StaffUserDocument>,
  ) {}

  // ───────── 1. Registered customers ─────────
  async registeredCustomers(filters: {
    from?: string;
    to?: string;
    tagId?: string;
    blocked?: string;
    agentId?: string;
  }): Promise<ReportPayload> {
    const range = parseDateRange(filters.from, filters.to);
    const q: FilterQuery<UserDocument> = {};
    applyDateRange(q, range, 'createdAt');
    if (filters.tagId) {
      assertObjectId(filters.tagId, 'tagId');
      q.tag = new Types.ObjectId(filters.tagId);
    }
    if (filters.blocked === 'true') q.isBlocked = true;
    if (filters.blocked === 'false') q.isBlocked = false;
    if (filters.agentId) {
      assertObjectId(filters.agentId, 'agentId');
      q.assignedAgent = new Types.ObjectId(filters.agentId);
    }

    const users = await this.userModel
      .find(q)
      .sort({ createdAt: -1 })
      .lean();

    const [tagMap, agentMap] = await Promise.all([
      this.loadTagMap(users.map((u) => u.tag).filter(Boolean) as Types.ObjectId[]),
      this.loadAgentMap(
        users
          .map((u) => u.assignedAgent)
          .filter(Boolean) as Types.ObjectId[],
      ),
    ]);

    const rows = users.map((u) => ({
      name: u.name,
      email: u.email,
      phone: u.phone,
      walletAddress: u.walletAddress,
      referralCode: u.referralCode,
      tag: u.tag ? tagMap.get(u.tag.toString()) ?? '' : '',
      role: u.role,
      isBlocked: u.isBlocked ? 'Yes' : 'No',
      isFrozen: u.isFrozen ? 'Yes' : 'No',
      emailVerified: u.emailVerified ? 'Yes' : 'No',
      phoneVerified: u.phoneVerified ? 'Yes' : 'No',
      assignedAgent: u.assignedAgent
        ? agentMap.get(u.assignedAgent.toString()) ?? ''
        : '',
      createdAt: fmtDate((u as any).createdAt),
    }));

    return {
      filename: 'registered-customers',
      sheetName: 'Customers',
      columns: [
        { header: 'Name', key: 'name', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Wallet Address', key: 'walletAddress', width: 38 },
        { header: 'Referral Code', key: 'referralCode', width: 14 },
        { header: 'Tag', key: 'tag', width: 14 },
        { header: 'Role', key: 'role', width: 12 },
        { header: 'Blocked', key: 'isBlocked', width: 10 },
        { header: 'Frozen', key: 'isFrozen', width: 10 },
        { header: 'Email Verified', key: 'emailVerified', width: 14 },
        { header: 'Phone Verified', key: 'phoneVerified', width: 14 },
        { header: 'Assigned Agent', key: 'assignedAgent', width: 24 },
        { header: 'Registered At', key: 'createdAt', width: 22 },
      ],
      rows,
    };
  }

  // ───────── 2. Deposits ─────────
  async deposits(filters: {
    from?: string;
    to?: string;
    userId?: string;
  }): Promise<ReportPayload> {
    const range = parseDateRange(filters.from, filters.to);
    const q: FilterQuery<DepositDocument> = {};
    applyDateRange(q, range, 'timestamp');
    if (filters.userId) {
      assertObjectId(filters.userId, 'userId');
      q.userId = new Types.ObjectId(filters.userId);
    }

    const docs = await this.depositModel.find(q).sort({ timestamp: -1 }).lean();
    const userMap = await this.loadUserMap(
      docs.map((d) => d.userId).filter(Boolean) as Types.ObjectId[],
    );

    const rows = docs.map((d) => {
      const u = d.userId ? userMap.get(d.userId.toString()) : null;
      return {
        timestamp: fmtDate(d.timestamp),
        transactionId: d.transactionId,
        userName: u?.name ?? '',
        userEmail: u?.email ?? '',
        walletAddress: d.walletAddress,
        amount: d.amount,
        currency: d.currency,
      };
    });

    return {
      filename: 'deposits',
      sheetName: 'Deposits',
      columns: [
        { header: 'Timestamp', key: 'timestamp', width: 22 },
        { header: 'Transaction ID', key: 'transactionId', width: 38 },
        { header: 'User Name', key: 'userName', width: 22 },
        { header: 'User Email', key: 'userEmail', width: 28 },
        { header: 'Wallet Address', key: 'walletAddress', width: 38 },
        { header: 'Amount', key: 'amount', width: 14, numFmt: '#,##0.000000' },
        { header: 'Currency', key: 'currency', width: 10 },
      ],
      rows,
    };
  }

  // ───────── 3. Withdrawals ─────────
  async withdrawals(filters: {
    from?: string;
    to?: string;
    status?: string;
    userId?: string;
    processedBy?: string;
  }): Promise<ReportPayload> {
    const range = parseDateRange(filters.from, filters.to);
    const q: FilterQuery<WithdrawalDocument> = {};
    applyDateRange(q, range, 'createdAt');
    if (filters.status) {
      if (
        !Object.values(WithdrawalStatus).includes(
          filters.status as WithdrawalStatus,
        )
      ) {
        throw new BadRequestException(
          `status must be one of: ${Object.values(WithdrawalStatus).join(', ')}`,
        );
      }
      q.status = filters.status;
    }
    if (filters.userId) {
      assertObjectId(filters.userId, 'userId');
      q.userId = new Types.ObjectId(filters.userId);
    }
    if (filters.processedBy) {
      assertObjectId(filters.processedBy, 'processedBy');
      q.processedBy = new Types.ObjectId(filters.processedBy);
    }

    const docs = await this.withdrawalModel
      .find(q)
      .sort({ createdAt: -1 })
      .lean();
    const [userMap, staffMap] = await Promise.all([
      this.loadUserMap(docs.map((d) => d.userId)),
      this.loadStaffMap(
        docs
          .map((d) => d.processedBy)
          .filter(Boolean) as Types.ObjectId[],
      ),
    ]);

    const rows = docs.map((d) => {
      const u = userMap.get(d.userId.toString());
      const staff = d.processedBy ? staffMap.get(d.processedBy.toString()) : null;
      return {
        createdAt: fmtDate((d as any).createdAt),
        userName: u?.name ?? '',
        userEmail: u?.email ?? '',
        method: d.method,
        amount: d.amount,
        feeUsdt: d.feeUsdt,
        netUsdt: d.netUsdt,
        netInr: d.netInr ?? '',
        status: d.status,
        bankName: d.bankName ?? '',
        accountNumber: d.accountNumber ?? '',
        ifscCode: d.ifscCode ?? '',
        destinationAddress: d.destinationAddress ?? '',
        utr: d.utr ?? '',
        txHash: d.txHash ?? '',
        processedBy: staff?.fullName ?? '',
        processedAt: d.processedAt ? fmtDate(d.processedAt) : '',
        decisionReason: d.decisionReason ?? '',
      };
    });

    return {
      filename: 'withdrawals',
      sheetName: 'Withdrawals',
      columns: [
        { header: 'Created At', key: 'createdAt', width: 22 },
        { header: 'User Name', key: 'userName', width: 22 },
        { header: 'User Email', key: 'userEmail', width: 28 },
        { header: 'Method', key: 'method', width: 10 },
        { header: 'Amount (USDT)', key: 'amount', width: 14, numFmt: '#,##0.000000' },
        { header: 'Fee (USDT)', key: 'feeUsdt', width: 14, numFmt: '#,##0.000000' },
        { header: 'Net (USDT)', key: 'netUsdt', width: 14, numFmt: '#,##0.000000' },
        { header: 'Net (INR)', key: 'netInr', width: 14, numFmt: '#,##0.00' },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Bank Name', key: 'bankName', width: 20 },
        { header: 'IFSC Code', key: 'ifscCode', width: 14 },
        { header: 'Account Number', key: 'accountNumber', width: 20 },
        { header: 'Crypto Address', key: 'destinationAddress', width: 38 },
        { header: 'UTR', key: 'utr', width: 18 },
        { header: 'Tx Hash', key: 'txHash', width: 38 },
        { header: 'Processed By', key: 'processedBy', width: 24 },
        { header: 'Processed At', key: 'processedAt', width: 22 },
        { header: 'Decision Reason', key: 'decisionReason', width: 30 },
      ],
      rows,
    };
  }

  // ───────── 4. Customer ledger (per user) ─────────
  async customerLedger(filters: {
    userId: string;
    from?: string;
    to?: string;
  }): Promise<ReportPayload> {
    if (!filters.userId) {
      throw new BadRequestException('userId is required');
    }
    assertObjectId(filters.userId, 'userId');
    const userOid = new Types.ObjectId(filters.userId);
    const user = await this.userModel.findById(userOid).lean();
    if (!user) throw new BadRequestException('User not found');

    const range = parseDateRange(filters.from, filters.to);

    const depQ: FilterQuery<DepositDocument> = { userId: userOid };
    applyDateRange(depQ, range, 'timestamp');
    const wdQ: FilterQuery<WithdrawalDocument> = { userId: userOid };
    applyDateRange(wdQ, range, 'createdAt');

    const [deposits, withdrawals] = await Promise.all([
      this.depositModel.find(depQ).lean(),
      this.withdrawalModel.find(wdQ).lean(),
    ]);

    type Entry = {
      when: Date;
      type: 'deposit' | 'withdrawal';
      direction: 'CREDIT' | 'DEBIT';
      amountUsdt: number;
      status: string;
      reference: string;
    };
    const entries: Entry[] = [
      ...deposits.map<Entry>((d) => ({
        when: d.timestamp,
        type: 'deposit',
        direction: 'CREDIT',
        amountUsdt: d.amount,
        status: 'confirmed',
        reference: d.transactionId,
      })),
      ...withdrawals.map<Entry>((w) => ({
        when: (w as any).createdAt,
        type: 'withdrawal',
        direction: 'DEBIT',
        amountUsdt: w.amount,
        status: w.status,
        reference: w.txHash ?? w.utr ?? (w._id as Types.ObjectId).toString(),
      })),
    ].sort((a, b) => a.when.getTime() - b.when.getTime());

    let running = 0;
    const rows = entries.map((e) => {
      const isFailedWithdrawal =
        e.type === 'withdrawal' && e.status === WithdrawalStatus.Failed;
      const delta = isFailedWithdrawal
        ? 0
        : e.direction === 'CREDIT'
          ? e.amountUsdt
          : -e.amountUsdt;
      running += delta;
      return {
        when: fmtDate(e.when),
        type: e.type,
        direction: e.direction,
        amountUsdt: e.amountUsdt,
        status: e.status,
        reference: e.reference,
        runningBalance: round6(running),
      };
    });

    return {
      filename: 'customer-ledger',
      sheetName: `${user.name}`.slice(0, 30) || 'Ledger',
      columns: [
        { header: 'Date/Time', key: 'when', width: 22 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'Direction', key: 'direction', width: 10 },
        { header: 'Amount (USDT)', key: 'amountUsdt', width: 16, numFmt: '#,##0.000000' },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Reference', key: 'reference', width: 38 },
        { header: 'Running Balance', key: 'runningBalance', width: 18, numFmt: '#,##0.000000' },
      ],
      rows,
    };
  }

  // ───────── 5. Customer balances (USDT + INR) ─────────
  async customerBalances(filters: {
    tagId?: string;
  }): Promise<ReportPayload> {
    const userQ: FilterQuery<UserDocument> = {};
    if (filters.tagId) {
      assertObjectId(filters.tagId, 'tagId');
      userQ.tag = new Types.ObjectId(filters.tagId);
    }
    const users = await this.userModel.find(userQ).lean();
    const ids = users.map((u) => u._id as Types.ObjectId);

    const [depAgg, wdAgg, globalPricing, userPricings, tagMap] =
      await Promise.all([
        this.depositModel.aggregate<{ _id: Types.ObjectId; total: number }>([
          { $match: { userId: { $in: ids } } },
          { $group: { _id: '$userId', total: { $sum: '$amount' } } },
        ]),
        this.withdrawalModel.aggregate<{
          _id: Types.ObjectId;
          total: number;
        }>([
          {
            $match: {
              userId: { $in: ids },
              status: {
                $in: [
                  WithdrawalStatus.Paid,
                  WithdrawalStatus.Processing,
                  WithdrawalStatus.Pending,
                ],
              },
            },
          },
          { $group: { _id: '$userId', total: { $sum: '$amount' } } },
        ]),
        this.pricingModel.findOne({ key: PRICING_SETTINGS_KEY }).lean(),
        this.userPricingModel.find({ userId: { $in: ids } }).lean(),
        this.loadTagMap(
          users.map((u) => u.tag).filter(Boolean) as Types.ObjectId[],
        ),
      ]);

    const depMap = new Map(depAgg.map((d) => [d._id.toString(), d.total]));
    const wdMap = new Map(wdAgg.map((w) => [w._id.toString(), w.total]));
    const upMap = new Map(
      userPricings.map((p) => [p.userId.toString(), p]),
    );

    const globalInrPrice = globalPricing?.inrPrice ?? 0;

    const rows = users.map((u) => {
      const id = (u._id as Types.ObjectId).toString();
      const dep = depMap.get(id) ?? 0;
      const wd = wdMap.get(id) ?? 0;
      const balanceUsdt = round6(dep - wd);
      const up = upMap.get(id);
      const inrRate =
        up && up.inrPrice !== null ? up.inrPrice : globalInrPrice;
      const balanceInr = round2(balanceUsdt * inrRate);
      return {
        name: u.name,
        email: u.email,
        phone: u.phone,
        tag: u.tag ? tagMap.get(u.tag.toString()) ?? '' : '',
        totalDeposited: round6(dep),
        totalWithdrawn: round6(wd),
        balanceUsdt,
        inrRate,
        balanceInr,
      };
    });

    return {
      filename: 'customer-balances',
      sheetName: 'Balances',
      columns: [
        { header: 'Name', key: 'name', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Tag', key: 'tag', width: 14 },
        { header: 'Total Deposited (USDT)', key: 'totalDeposited', width: 20, numFmt: '#,##0.000000' },
        { header: 'Total Withdrawn (USDT)', key: 'totalWithdrawn', width: 20, numFmt: '#,##0.000000' },
        { header: 'Balance (USDT)', key: 'balanceUsdt', width: 18, numFmt: '#,##0.000000' },
        { header: 'INR Rate', key: 'inrRate', width: 12, numFmt: '#,##0.00' },
        { header: 'Balance (INR)', key: 'balanceInr', width: 18, numFmt: '#,##0.00' },
      ],
      rows,
    };
  }

  // ───────── 6. Users by tag(s) ─────────
  async usersByTag(filters: { tags?: string }): Promise<ReportPayload> {
    const names = (filters.tags ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) {
      throw new BadRequestException(
        'tags query param is required (comma-separated tag names)',
      );
    }
    const tags = await this.userTagModel
      .find({ name: { $in: names } })
      .lean();
    if (!tags.length) {
      throw new BadRequestException(
        `None of the provided tags exist: ${names.join(', ')}`,
      );
    }
    const tagIds = tags.map((t) => t._id as Types.ObjectId);
    const tagMap = new Map(
      tags.map((t) => [(t._id as Types.ObjectId).toString(), t.name]),
    );

    const users = await this.userModel
      .find({ tag: { $in: tagIds } })
      .sort({ createdAt: -1 })
      .lean();

    const rows = users.map((u) => ({
      name: u.name,
      email: u.email,
      phone: u.phone,
      walletAddress: u.walletAddress,
      tag: u.tag ? tagMap.get(u.tag.toString()) ?? '' : '',
      tagAssignedAt: u.tagAssignedAt ? fmtDate(u.tagAssignedAt) : '',
      tagSource: u.tagAssignmentSource ?? '',
      registeredAt: fmtDate((u as any).createdAt),
    }));

    return {
      filename: `users-by-tag-${names.join('_')}`,
      sheetName: 'Users by Tag',
      columns: [
        { header: 'Name', key: 'name', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Wallet Address', key: 'walletAddress', width: 38 },
        { header: 'Tag', key: 'tag', width: 14 },
        { header: 'Tag Assigned At', key: 'tagAssignedAt', width: 22 },
        { header: 'Tag Source', key: 'tagSource', width: 12 },
        { header: 'Registered At', key: 'registeredAt', width: 22 },
      ],
      rows,
    };
  }

  // ───────── 7. Active customers (last N days) ─────────
  async activeCustomers(filters: { days?: string }): Promise<ReportPayload> {
    const days = parsePositiveInt(filters.days ?? '10', 'days');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [activeDepUserIds, activeWdUserIds] = await Promise.all([
      this.depositModel.distinct('userId', { timestamp: { $gte: since } }),
      this.withdrawalModel.distinct('userId', { createdAt: { $gte: since } }),
    ]);
    const idSet = new Set(
      [...activeDepUserIds, ...activeWdUserIds]
        .filter(Boolean)
        .map((id: any) => id.toString()),
    );
    const ids = Array.from(idSet).map((s) => new Types.ObjectId(s));

    const users = await this.userModel.find({ _id: { $in: ids } }).lean();

    const [depAgg, wdAgg, tagMap] = await Promise.all([
      this.depositModel.aggregate<{
        _id: Types.ObjectId;
        total: number;
        count: number;
        last: Date;
      }>([
        { $match: { userId: { $in: ids }, timestamp: { $gte: since } } },
        {
          $group: {
            _id: '$userId',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
            last: { $max: '$timestamp' },
          },
        },
      ]),
      this.withdrawalModel.aggregate<{
        _id: Types.ObjectId;
        total: number;
        count: number;
        last: Date;
      }>([
        { $match: { userId: { $in: ids }, createdAt: { $gte: since } } },
        {
          $group: {
            _id: '$userId',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
            last: { $max: '$createdAt' },
          },
        },
      ]),
      this.loadTagMap(
        users.map((u) => u.tag).filter(Boolean) as Types.ObjectId[],
      ),
    ]);
    const depMap = new Map(depAgg.map((d) => [d._id.toString(), d]));
    const wdMap = new Map(wdAgg.map((w) => [w._id.toString(), w]));

    const rows = users.map((u) => {
      const id = (u._id as Types.ObjectId).toString();
      const d = depMap.get(id);
      const w = wdMap.get(id);
      return {
        name: u.name,
        email: u.email,
        phone: u.phone,
        tag: u.tag ? tagMap.get(u.tag.toString()) ?? '' : '',
        depositCount: d?.count ?? 0,
        depositTotal: round6(d?.total ?? 0),
        lastDepositAt: d?.last ? fmtDate(d.last) : '',
        withdrawalCount: w?.count ?? 0,
        withdrawalTotal: round6(w?.total ?? 0),
        lastWithdrawalAt: w?.last ? fmtDate(w.last) : '',
      };
    });

    return {
      filename: `active-customers-last-${days}d`,
      sheetName: 'Active Customers',
      columns: [
        { header: 'Name', key: 'name', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Tag', key: 'tag', width: 14 },
        { header: 'Deposit Count', key: 'depositCount', width: 14 },
        { header: 'Total Deposited (USDT)', key: 'depositTotal', width: 20, numFmt: '#,##0.000000' },
        { header: 'Last Deposit At', key: 'lastDepositAt', width: 22 },
        { header: 'Withdrawal Count', key: 'withdrawalCount', width: 16 },
        { header: 'Total Withdrawn (USDT)', key: 'withdrawalTotal', width: 20, numFmt: '#,##0.000000' },
        { header: 'Last Withdrawal At', key: 'lastWithdrawalAt', width: 22 },
      ],
      rows,
    };
  }

  // ───────── 8. Inactive customers (no deposit in last N period) ─────────
  async inactiveCustomers(filters: {
    period?: string;
    count?: string;
  }): Promise<ReportPayload> {
    const period = (filters.period ?? 'day').toLowerCase();
    const count = parsePositiveInt(filters.count ?? '30', 'count');
    const multiplier =
      period === 'day' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : -1;
    if (multiplier < 0) {
      throw new BadRequestException('period must be day, week, or month');
    }
    const since = new Date(Date.now() - count * multiplier * 24 * 60 * 60 * 1000);

    const recentDepUserIds = await this.depositModel.distinct('userId', {
      timestamp: { $gte: since },
    });
    const excludeIds = recentDepUserIds.filter(Boolean) as Types.ObjectId[];

    const users = await this.userModel
      .find({ _id: { $nin: excludeIds } })
      .lean();
    const tagMap = await this.loadTagMap(
      users.map((u) => u.tag).filter(Boolean) as Types.ObjectId[],
    );

    const lastDepositAgg = await this.depositModel.aggregate<{
      _id: Types.ObjectId;
      last: Date;
      total: number;
    }>([
      { $match: { userId: { $in: users.map((u) => u._id) } } },
      {
        $group: {
          _id: '$userId',
          last: { $max: '$timestamp' },
          total: { $sum: '$amount' },
        },
      },
    ]);
    const lastDepMap = new Map(
      lastDepositAgg.map((d) => [d._id.toString(), d]),
    );

    const rows = users.map((u) => {
      const id = (u._id as Types.ObjectId).toString();
      const last = lastDepMap.get(id);
      return {
        name: u.name,
        email: u.email,
        phone: u.phone,
        tag: u.tag ? tagMap.get(u.tag.toString()) ?? '' : '',
        registeredAt: fmtDate((u as any).createdAt),
        lifetimeDeposit: round6(last?.total ?? 0),
        lastDepositAt: last?.last ? fmtDate(last.last) : 'never',
      };
    });

    return {
      filename: `inactive-customers-${count}${period}`,
      sheetName: 'Inactive Customers',
      columns: [
        { header: 'Name', key: 'name', width: 24 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Phone', key: 'phone', width: 16 },
        { header: 'Tag', key: 'tag', width: 14 },
        { header: 'Registered At', key: 'registeredAt', width: 22 },
        { header: 'Lifetime Deposit (USDT)', key: 'lifetimeDeposit', width: 22, numFmt: '#,##0.000000' },
        { header: 'Last Deposit At', key: 'lastDepositAt', width: 22 },
      ],
      rows,
    };
  }

  // ───────── 9. Pending withdrawals ─────────
  async pendingWithdrawals(): Promise<ReportPayload> {
    const docs = await this.withdrawalModel
      .find({ status: WithdrawalStatus.Pending })
      .sort({ createdAt: 1 })
      .lean();
    const userMap = await this.loadUserMap(docs.map((d) => d.userId));

    const rows = docs.map((d) => {
      const u = userMap.get(d.userId.toString());
      return {
        createdAt: fmtDate((d as any).createdAt),
        userName: u?.name ?? '',
        userEmail: u?.email ?? '',
        userPhone: u?.phone ?? '',
        method: d.method,
        amount: d.amount,
        netUsdt: d.netUsdt,
        netInr: d.netInr ?? '',
        bankName: d.bankName ?? '',
        accountNumber: d.accountNumber ?? '',
        ifscCode: d.ifscCode ?? '',
        destinationAddress: d.destinationAddress ?? '',
      };
    });

    return {
      filename: 'pending-withdrawals',
      sheetName: 'Pending Withdrawals',
      columns: [
        { header: 'Requested At', key: 'createdAt', width: 22 },
        { header: 'User Name', key: 'userName', width: 22 },
        { header: 'User Email', key: 'userEmail', width: 28 },
        { header: 'User Phone', key: 'userPhone', width: 16 },
        { header: 'Method', key: 'method', width: 10 },
        { header: 'Amount (USDT)', key: 'amount', width: 14, numFmt: '#,##0.000000' },
        { header: 'Net (USDT)', key: 'netUsdt', width: 14, numFmt: '#,##0.000000' },
        { header: 'Net (INR)', key: 'netInr', width: 14, numFmt: '#,##0.00' },
        { header: 'Bank Name', key: 'bankName', width: 20 },
        { header: 'IFSC Code', key: 'ifscCode', width: 14 },
        { header: 'Account Number', key: 'accountNumber', width: 20 },
        { header: 'Crypto Address', key: 'destinationAddress', width: 38 },
      ],
      rows,
    };
  }

  // ───────── 10. Tickets ─────────
  async tickets(filters: {
    from?: string;
    to?: string;
    team?: string;
    resolutionStatus?: string;
    assigneeId?: string;
  }): Promise<ReportPayload> {
    const range = parseDateRange(filters.from, filters.to);
    const q: FilterQuery<TicketDocument> = {};
    applyDateRange(q, range, 'createdAt');
    if (filters.team) q.team = filters.team;
    if (filters.resolutionStatus) q.resolutionStatus = filters.resolutionStatus;
    if (filters.assigneeId) {
      assertObjectId(filters.assigneeId, 'assigneeId');
      q.assigneeId = new Types.ObjectId(filters.assigneeId);
    }

    const docs = await this.ticketModel.find(q).sort({ createdAt: -1 }).lean();
    const [userMap, staffMap] = await Promise.all([
      this.loadUserMap(docs.map((d) => d.userId)),
      this.loadStaffMap(
        docs.map((d) => d.assigneeId).filter(Boolean) as Types.ObjectId[],
      ),
    ]);

    const rows = docs.map((d) => {
      const creator =
        d.createdByType === 'staff'
          ? staffMap.get(d.userId.toString())?.fullName
          : userMap.get(d.userId.toString())?.name;
      const assignee = d.assigneeId
        ? staffMap.get(d.assigneeId.toString())?.fullName
        : null;
      const resolutionHours =
        d.resolvedAt && (d as any).createdAt
          ? Math.round(
              ((d.resolvedAt as Date).getTime() -
                ((d as any).createdAt as Date).getTime()) /
                36e5,
            )
          : '';
      return {
        createdAt: fmtDate((d as any).createdAt),
        title: d.title,
        createdByType: d.createdByType,
        creator: creator ?? '',
        team: d.team,
        assignee: assignee ?? '',
        resolutionStatus: d.resolutionStatus,
        resolvedAt: d.resolvedAt ? fmtDate(d.resolvedAt) : '',
        resolutionHours,
      };
    });

    return {
      filename: 'tickets',
      sheetName: 'Tickets',
      columns: [
        { header: 'Created At', key: 'createdAt', width: 22 },
        { header: 'Title', key: 'title', width: 40 },
        { header: 'Created By Type', key: 'createdByType', width: 16 },
        { header: 'Creator', key: 'creator', width: 22 },
        { header: 'Team', key: 'team', width: 12 },
        { header: 'Assignee', key: 'assignee', width: 22 },
        { header: 'Status', key: 'resolutionStatus', width: 12 },
        { header: 'Resolved At', key: 'resolvedAt', width: 22 },
        { header: 'Resolution (hours)', key: 'resolutionHours', width: 18 },
      ],
      rows,
    };
  }

  // ───────── helpers ─────────
  private async loadUserMap(
    ids: Types.ObjectId[],
  ): Promise<Map<string, { name: string; email: string; phone: string }>> {
    if (!ids.length) return new Map();
    const docs = await this.userModel
      .find({ _id: { $in: ids } })
      .select('name email phone')
      .lean();
    return new Map(
      docs.map((d) => [
        (d._id as Types.ObjectId).toString(),
        { name: d.name, email: d.email, phone: d.phone },
      ]),
    );
  }

  private async loadStaffMap(
    ids: Types.ObjectId[],
  ): Promise<Map<string, { fullName: string; email: string }>> {
    if (!ids.length) return new Map();
    const docs = await this.staffModel
      .find({ _id: { $in: ids } })
      .select('fullName email')
      .lean();
    return new Map(
      docs.map((d) => [
        (d._id as Types.ObjectId).toString(),
        { fullName: d.fullName, email: d.email },
      ]),
    );
  }

  private async loadTagMap(
    ids: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const docs = await this.userTagModel
      .find({ _id: { $in: ids } })
      .select('name')
      .lean();
    return new Map(
      docs.map((d) => [(d._id as Types.ObjectId).toString(), d.name]),
    );
  }

  private async loadAgentMap(
    ids: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const m = await this.loadStaffMap(ids);
    return new Map(Array.from(m.entries()).map(([k, v]) => [k, v.fullName]));
  }
}

// ───────── module-private utilities ─────────

function parseDateRange(from?: string, to?: string): DateRange {
  const range: DateRange = {};
  if (from) {
    const d = new Date(from);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid 'from' date: ${from}`);
    }
    range.from = d;
  }
  if (to) {
    const d = new Date(to);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid 'to' date: ${to}`);
    }
    range.to = d;
  }
  return range;
}

function applyDateRange(
  q: FilterQuery<any>,
  range: DateRange,
  field: string,
): void {
  if (!range.from && !range.to) return;
  q[field] = {};
  if (range.from) q[field].$gte = range.from;
  if (range.to) q[field].$lte = range.to;
}

function assertObjectId(value: string, field: string): void {
  if (!Types.ObjectId.isValid(value)) {
    throw new BadRequestException(`Invalid ${field}: ${value}`);
  }
}

function parsePositiveInt(value: string, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
  return n;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

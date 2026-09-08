import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Deposit, DepositDocument } from '../deposits/schemas/deposit.schema';
import {
  WithdrawalDispute,
  WithdrawalDisputeDocument,
} from '../withdrawal-disputes/schemas/withdrawal-dispute.schema';
import { TicketResolutionStatus } from '../tickets/schemas/ticket.schema';
import {
  SMART_DECLINE_WINDOW_MS,
  UPI_DISPUTE_WINDOW_MS,
} from '../withdrawals/constants';

export type TransactionType = 'deposit' | 'withdrawal';

export interface UnifiedTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  upiId: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  ifscCode?: string | null;
  isSmart: boolean;
  inrAmount: number | null;
  declineWindowExpiresAt: string | null;
  disputeWindowExpiresAt: string | null;
  walletAddress: string | null;
  transactionId: string | null;
  txHash: string | null;
  destination: Record<string, unknown> | null;
  timestamp: string | null;
  createdAt: string;
  remark: string | null;
  decisionReason?: string | null;
  disputeRaised?: boolean;
  disputeDetails?: Record<string, any> | null;
}

interface AggregateRow {
  _id: Types.ObjectId;
  type: TransactionType;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  upiId?: string;
  isSmart?: boolean;
  smartMatchedAt?: Date;
  processedAt?: Date;
  inrAmount?: number;
  walletAddress?: string;
  transactionId?: string;
  txHash?: string;
  destination?: Record<string, unknown>;
  timestamp?: Date;
  createdAt: Date;
  remark?: string;
  decisionReason?: string;
  disputeRaised?: boolean;
}

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel(Deposit.name)
    private readonly depositModel: Model<DepositDocument>,
    @InjectModel(WithdrawalDispute.name)
    private readonly disputeModel: Model<WithdrawalDisputeDocument>,
  ) {}

  async listForUser(
    userId: string,
    limit = 50,
  ): Promise<UnifiedTransaction[]> {
    const uid = new Types.ObjectId(userId);

    const rows = await this.depositModel.aggregate<AggregateRow>([
      { $match: { userId: uid } },
      {
        $project: {
          _id: 1,
          type: { $literal: 'deposit' },
          amount: '$amount',
          currency: '$currency',
          status: { $literal: 'completed' },
          walletAddress: '$walletAddress',
          transactionId: '$transactionId',
          timestamp: '$timestamp',
          createdAt: '$createdAt',
          remark: '$rawPayload.remark',
        },
      },
      {
        $unionWith: {
          coll: 'withdrawals',
          pipeline: [
            { $match: { userId: uid } },
            {
              $project: {
                _id: 1,
                type: { $literal: 'withdrawal' },
                amount: '$amount',
                currency: { $literal: 'USDT' },
                status: '$status',
                method: '$method',
                upiId: '$upiId',
                bankName: '$bankName',
                accountNumber: '$accountNumber',
                ifscCode: '$ifscCode',
                isSmart: '$isSmart',
                smartMatchedAt: '$smartMatchedAt',
                processedAt: '$processedAt',
                inrAmount: '$netInr',
                txHash: '$txHash',
                utr: '$utr',
                paymentProofUrl: '$paymentProofUrl',
                userConfirmedAt: '$userConfirmedAt',
                disputeRaised: '$disputeRaised',
                secondDisputeAttempted: '$secondDisputeAttempted',
                decisionReason: '$decisionReason',
                disputeWindowExpiresAt: '$disputeWindowExpiresAt',
                timestamp: '$createdAt',
                createdAt: '$createdAt',
                remark: '$notes',
              },
            },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
    ]);

    const withdrawalIds = rows
      .filter((r) => r.type === 'withdrawal')
      .map((r) => r._id);
    const disputes = await this.disputeModel.find({
      withdrawalId: { $in: withdrawalIds },
    });
    const disputeMap = new Map(
      disputes.map((dp) => [dp.withdrawalId.toString(), dp]),
    );

    return rows.map((r: any) => {
      const dp =
        r.type === 'withdrawal'
          ? disputeMap.get(r._id.toString())
          : null;
      const isProcessed =
        r.status === 'paid' ||
        r.status === 'failed' ||
        r.status === 'resolved' ||
        dp?.resolutionStatus === TicketResolutionStatus.Resolved;
      const disputeRaised = isProcessed ? false : Boolean(r.disputeRaised);
      const disputeDetails = dp
        ? {
            id: dp._id.toString(),
            reason: dp.reason,
            description: dp.description ?? null,
            resolutionStatus: dp.resolutionStatus,
            resolutionDecision: dp.resolutionDecision ?? null,
            resolutionNotes:
              dp.resolutionNotes ??
              r.decisionReason ??
              'Dispute reviewed and resolved by admin.',
            resolvedAt: dp.resolvedAt ? dp.resolvedAt.toISOString() : null,
            resolvedBy: dp.resolvedBy ? dp.resolvedBy.toString() : 'Admin',
          }
        : null;

      return {
        id: r._id.toString(),
        type: r.type,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        method: r.method ?? null,
        upiId: r.upiId ?? null,
        bankName: r.bankName ?? null,
        accountNumber: r.accountNumber ?? null,
        ifscCode: r.ifscCode ?? null,
        isSmart: r.isSmart ?? false,
        inrAmount: r.inrAmount ?? null,
        utr: r.utr ?? null,
        paymentProofUrl: r.paymentProofUrl ?? null,
        userConfirmedAt: r.userConfirmedAt
          ? new Date(r.userConfirmedAt).toISOString()
          : null,
        disputeRaised,
        secondDisputeAttempted: Boolean(r.secondDisputeAttempted),
        decisionReason: r.decisionReason ?? null,
        disputeDetails,
        declineWindowExpiresAt:
          r.isSmart && r.status === 'awaiting_payment' && r.smartMatchedAt
            ? new Date(
                new Date(r.smartMatchedAt).getTime() + SMART_DECLINE_WINDOW_MS,
              ).toISOString()
            : null,
        disputeWindowExpiresAt:
          r.disputeWindowExpiresAt
            ? new Date(r.disputeWindowExpiresAt).toISOString()
            : r.type === 'withdrawal' &&
              (r.status === 'paid' || r.status === 'completed') &&
              r.processedAt &&
              !r.secondDisputeAttempted
            ? new Date(
                new Date(r.processedAt).getTime() + UPI_DISPUTE_WINDOW_MS,
              ).toISOString()
            : null,
        walletAddress: r.walletAddress ?? null,
        transactionId: r.transactionId ?? null,
        txHash: r.txHash ?? null,
        destination: r.destination ?? null,
        timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : null,
        createdAt: new Date(r.createdAt).toISOString(),
        remark:
          r.remark && !r.remark.toLowerCase().includes('smart auto-liquidation')
            ? r.remark
            : null,
      };
    });
  }
}

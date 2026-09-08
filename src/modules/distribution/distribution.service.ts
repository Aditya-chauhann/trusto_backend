import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { StaffUser, StaffUserDocument } from '../staff/schemas/staff-user.schema';
import { Deposit, DepositDocument } from '../deposits/schemas/deposit.schema';
import { Withdrawal, WithdrawalDocument } from '../withdrawals/schemas/withdrawal.schema';

@Injectable()
export class DistributionService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(StaffUser.name) private readonly staffUserModel: Model<StaffUserDocument>,
    @InjectModel(Deposit.name) private readonly depositModel: Model<DepositDocument>,
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<WithdrawalDocument>,
  ) {}

  async getDistributionStats(userId: string) {
    const uid = new Types.ObjectId(userId);
    let referralCode = '';
    let matchFilter: any = { invitedBy: uid };

    // 1. Try customer User first
    let currentUser = await this.userModel.findById(uid).select('referralCode');
    if (currentUser) {
      if (!currentUser.referralCode) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        currentUser.referralCode = code;
        await currentUser.save();
      }
      referralCode = currentUser.referralCode;
    } else {
      // 2. If not a customer user, check if it is a Staff/Agent user
      let staffUser = await this.staffUserModel.findById(uid).select('agentCode username isSuperAdmin');
      if (staffUser) {
        if (!staffUser.agentCode) {
          const code = crypto.randomBytes(4).toString('hex').toUpperCase();
          staffUser.agentCode = code;
          await staffUser.save();
        }
        referralCode = staffUser.agentCode;

        // If Super Admin, match all users or assigned users; if Agent, match assigned or invited users
        if (staffUser.isSuperAdmin) {
          matchFilter = {}; // Super Admin sees all platform users
        } else {
          matchFilter = {
            $or: [{ invitedBy: uid }, { assignedAgent: uid }],
          };
        }
      } else {
        referralCode = 'N/A';
      }
    }

    // Fetch invitees / network users with transaction counts
    const invitees = await this.userModel.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: 'deposits',
          localField: '_id',
          foreignField: 'userId',
          as: 'deposits',
        },
      },
      {
        $lookup: {
          from: 'withdrawals',
          localField: '_id',
          foreignField: 'userId',
          as: 'withdrawals',
        },
      },
      {
        $project: {
          _id: 1,
          serialId: 1,
          name: 1,
          email: 1,
          createdAt: 1,
          transactions: { $add: [{ $size: '$deposits' }, { $size: '$withdrawals' }] },
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    const formattedInvitees = invitees.map((i) => ({
      id: i.serialId || i._id.toString(),
      serialId: i.serialId || '',
      name: i.name,
      email: i.email,
      joinedAt: i.createdAt.toISOString(),
      transactions: i.transactions,
    }));

    // Fetch all staff agents for Agents Overview
    const allStaff = await this.staffUserModel
      .find()
      .select('fullName username email agentCode isSuperAdmin createdAt');

    const agents = await Promise.all(
      allStaff.map(async (staff) => {
        const staffId = staff._id;
        const agentInvitees = await this.userModel.aggregate([
          {
            $match: {
              $or: [{ invitedBy: staffId }, { assignedAgent: staffId }],
            },
          },
          {
            $lookup: {
              from: 'deposits',
              localField: '_id',
              foreignField: 'userId',
              as: 'deposits',
            },
          },
          {
            $lookup: {
              from: 'withdrawals',
              localField: '_id',
              foreignField: 'userId',
              as: 'withdrawals',
            },
          },
          {
            $project: {
              _id: 1,
              serialId: 1,
              name: 1,
              email: 1,
              createdAt: 1,
              transactions: { $add: [{ $size: '$deposits' }, { $size: '$withdrawals' }] },
            },
          },
          { $sort: { createdAt: -1 } },
        ]);

        const staffCreatedAt = (staff as any).createdAt;
        return {
          id: staffId.toString(),
          name: staff.fullName || staff.username,
          username: staff.username,
          email: staff.email || `${staff.username}@platform.com`,
          agentCode: staff.agentCode || 'N/A',
          joinedAt: staffCreatedAt ? new Date(staffCreatedAt).toISOString() : new Date().toISOString(),
          referralsCount: agentInvitees.length,
          invitees: agentInvitees.map((i) => ({
            id: i.serialId || i._id.toString(),
            serialId: i.serialId || '',
            name: i.name,
            email: i.email,
            joinedAt: i.createdAt.toISOString(),
            transactions: i.transactions,
          })),
        };
      }),
    );

    return {
      referralCode,
      invitees: formattedInvitees,
      agents,
    };
  }

  async getInviteeTimeline(userId: string, inviteeId: string) {
    const invitee = await this.userModel.findById(inviteeId);
    if (!invitee) {
      throw new NotFoundException('Invitee not found');
    }

    const uid = new Types.ObjectId(userId);
    const isStaff = await this.staffUserModel.exists({ _id: uid });
    const requestingUser = !isStaff ? await this.userModel.findById(uid).select('role').lean() : null;
    const isUserAdmin =
      requestingUser?.role === UserRole.SuperAdmin ||
      (requestingUser?.role as any) === 'admin' ||
      (requestingUser?.role as any) === 'superadmin';

    const isAuthorized =
      !!isStaff ||
      !!requestingUser ||
      String(invitee.invitedBy) === userId ||
      String(invitee.assignedAgent) === userId;

    if (!isAuthorized) {
      throw new ForbiddenException('You do not have permission to view this user');
    }

    const inviteeObjectId = new Types.ObjectId(inviteeId);

    const [deposits, withdrawals] = await Promise.all([
      this.depositModel.find({ userId: inviteeObjectId }).sort({ timestamp: -1 }).lean(),
      this.withdrawalModel.find({ userId: inviteeObjectId }).sort({ createdAt: -1 }).lean(),
    ]);

    const transactions = [
      ...deposits.map((d) => ({
        id: (d as any).transactionId || (d as any)._id.toString(),
        type: 'DEPOSIT',
        amount: (d as any).amount,
        date: (d as any).timestamp,
        status: 'SUCCESS',
      })),
      ...withdrawals.map((w) => ({
        id: (w as any).txHash || (w as any).utr || (w as any)._id.toString(),
        type: 'WITHDRAW',
        amount: (w as any).netInr || (w as any).grossInr || (w as any).amount,
        date: (w as any).createdAt,
        status: (w as any).status.toUpperCase() === 'FAILED' ? 'REJECTED' : (w as any).status.toUpperCase(),
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      invitee: {
        id: (invitee as any).serialId || invitee._id.toString(),
        serialId: (invitee as any).serialId || '',
        name: invitee.name,
        email: invitee.email,
        joinedAt: (invitee as any).createdAt,
      },
      transactions,
    };
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  StaffUser,
  StaffUserDocument,
} from './schemas/staff-user.schema';
import {
  StaffRole,
  StaffRoleDocument,
} from './schemas/staff-role.schema';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import { SUPERADMIN_PERMISSION } from './permissions.constants';
import { StaffLoginDto } from './dto/staff-login.dto';
import { ChangeStaffPasswordDto } from './dto/change-password.dto';
import { IpActivityService } from '../ip-activity/ip-activity.service';

const BCRYPT_ROUNDS = 12;

export interface StaffSessionResponse {
  accountType: 'staff';
  accessToken: string;
  staff: {
    id: string;
    username: string;
    email: string;
    fullName: string;
    isSuperAdmin: boolean;
    mustChangePassword: boolean;
    /** Super admins only: whether a login PIN has been generated yet. */
    pinSet: boolean;
    /** Always false on login — the PIN is entered through /admin/auth/pin/verify. */
    pinVerified: boolean;
    role: {
      id: string;
      name: string;
      permissions: string[];
    } | null;
    permissions: string[];
  };
}

export interface StaffTotpChallengeResponse {
  accountType: 'staff';
  requiresTotp: true;
  loginChallenge: string;
  staff: {
    id: string;
    email: string;
    username: string;
    fullName: string;
  };
}

export interface UserSuperAdminSessionResponse {
  accountType: 'user';
  accessToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    walletAddress: string | null;
    referralCode: string;
    role: UserRole;
    assignedAgent: {
      id: string;
      fullName: string;
      email: string;
    } | null;
  };
}

export interface UserSuperAdminTotpChallengeResponse {
  accountType: 'user';
  requiresTotp: true;
  loginChallenge: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export type StaffLoginResult =
  | StaffSessionResponse
  | StaffTotpChallengeResponse
  | UserSuperAdminSessionResponse
  | UserSuperAdminTotpChallengeResponse;

import { AlertsService } from '../alerts/alerts.service';
import { AlertSeverity, AlertType } from '../alerts/schemas/alert.schema';

@Injectable()
export class StaffAuthService {
  constructor(
    @InjectModel(StaffUser.name)
    private readonly staffUserModel: Model<StaffUserDocument>,
    @InjectModel(StaffRole.name)
    private readonly staffRoleModel: Model<StaffRoleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly alertsService: AlertsService,
    private readonly ipActivityService: IpActivityService,
  ) {}

  async requestPasswordReset(identifier: string): Promise<{ ok: true; message: string }> {
    const normalized = identifier.toLowerCase().trim();
    if (!normalized) {
      throw new BadRequestException('Email or username is required');
    }

    const staff = await this.findStaffByIdentifier(normalized);
    if (staff) {
      await this.alertsService.create({
        type: AlertType.StaffPasswordResetRequest,
        severity: AlertSeverity.High,
        title: `Password Reset Requested by ${staff.fullName}`,
        message: `Agent/Staff member ${staff.fullName} (${staff.email}) requested a password reset. Grant a temporary password to approve.`,
        metadata: {
          staffId: (staff._id as Types.ObjectId).toString(),
          email: staff.email,
          username: staff.username,
          fullName: staff.fullName,
        },
      });
    }

    return {
      ok: true,
      message: 'Admin has been notified. He will revert your request soon.',
    };
  }

  async login(dto: StaffLoginDto, ip?: string): Promise<StaffLoginResult> {
    const identifier = dto.email.toLowerCase().trim();
    const staff = await this.findStaffByIdentifier(identifier);

    if (staff) {
      return this.loginStaff(staff, dto.password, ip);
    }

    if (identifier.includes('@')) {
      try {
        return await this.loginSuperAdminUser(identifier, dto.password, ip);
      } catch (err) {
        const user = await this.userModel.findOne({ email: identifier }).select('_id');
        if (user) {
          if (ip) {
            void this.ipActivityService.log({
              email: identifier,
              actionType: 'login_failed',
              ipAddress: ip,
              details: { reason: 'User redirected to user portal' },
            }).catch(() => {});
          }
          throw new UnauthorizedException('Please login through the user portal');
        }
        if (ip) {
          void this.ipActivityService.log({
            email: identifier,
            actionType: 'login_failed',
            ipAddress: ip,
            details: { reason: err instanceof Error ? err.message : 'Invalid credentials' },
          }).catch(() => {});
        }
        throw err;
      }
    }

    const user = await this.userModel.findOne({ email: identifier }).select('_id');
    if (user) {
      if (ip) {
        void this.ipActivityService.log({
          email: identifier,
          actionType: 'login_failed',
          ipAddress: ip,
          details: { reason: 'User redirected to user portal' },
        }).catch(() => {});
      }
      throw new UnauthorizedException('Please login through the user portal');
    }

    if (ip) {
      void this.ipActivityService.log({
        email: identifier,
        actionType: 'login_failed',
        ipAddress: ip,
        details: { reason: 'Invalid credentials' },
      }).catch(() => {});
    }
    throw new UnauthorizedException('Invalid credentials');
  }

  async changePassword(
    staffId: string,
    dto: ChangeStaffPasswordDto,
  ): Promise<{ ok: true }> {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }
    const staff = await this.staffUserModel.findById(staffId);
    if (!staff) throw new UnauthorizedException();

    const ok = await bcrypt.compare(dto.currentPassword, staff.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    staff.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    staff.mustChangePassword = false;
    await staff.save();
    return { ok: true };
  }

  async buildSession(
    staff: StaffUserDocument,
  ): Promise<StaffSessionResponse> {
    const id = (staff._id as Types.ObjectId).toString();
    const accessToken = this.jwtService.sign({
      sub: id,
      type: 'staff',
      email: staff.email,
      username: staff.username,
    });

    let rolePayload: StaffSessionResponse['staff']['role'] = null;
    let permissions: string[] = [];

    if (staff.isSuperAdmin) {
      permissions = [SUPERADMIN_PERMISSION];
    } else if (staff.roleId) {
      const role = await this.staffRoleModel.findById(staff.roleId);
      if (role && role.isActive) {
        permissions = role.permissions;
        rolePayload = {
          id: (role._id as Types.ObjectId).toString(),
          name: role.name,
          permissions: role.permissions,
        };
      }
    }

    return {
      accountType: 'staff',
      accessToken,
      staff: {
        id,
        username: staff.username,
        email: staff.email,
        fullName: staff.fullName,
        isSuperAdmin: staff.isSuperAdmin,
        mustChangePassword: staff.mustChangePassword,
        pinSet: staff.isSuperAdmin ? Boolean(staff.pinHash) : false,
        pinVerified: false,
        role: rolePayload,
        permissions,
      },
    };
  }

  private async loginStaff(
    staff: StaffUserDocument,
    password: string,
    ip?: string,
  ): Promise<StaffSessionResponse | StaffTotpChallengeResponse> {
    const ok = await bcrypt.compare(password, staff.passwordHash);
    if (!ok) {
      if (ip && !staff.isSuperAdmin) {
        void this.ipActivityService.log({
          email: staff.email,
          actionType: 'wrong_password',
          ipAddress: ip,
          details: { role: 'staff' },
        }).catch(() => {});
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!staff.isActive) {
      if (ip && !staff.isSuperAdmin) {
        void this.ipActivityService.log({
          email: staff.email,
          actionType: 'login_failed',
          ipAddress: ip,
          details: { reason: 'Staff account deactivated' },
        }).catch(() => {});
      }
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'STAFF_INACTIVE',
        message: 'Your staff account has been deactivated.',
      });
    }

    staff.lastLoginAt = new Date();
    await staff.save();

    if (ip && !staff.isSuperAdmin) {
      void this.ipActivityService.log({
        email: staff.email,
        actionType: 'login_success',
        ipAddress: ip,
        details: { role: 'staff' },
      }).catch(() => {});
    }

    if (staff.totpEnabled) {
      const id = (staff._id as Types.ObjectId).toString();
      return {
        accountType: 'staff',
        requiresTotp: true,
        loginChallenge: this.createLoginChallenge(id, 'staff'),
        staff: {
          id,
          email: staff.email,
          username: staff.username,
          fullName: staff.fullName,
        },
      };
    }

    return this.buildSession(staff);
  }

  private async loginSuperAdminUser(
    email: string,
    password: string,
    ip?: string,
  ): Promise<UserSuperAdminSessionResponse | UserSuperAdminTotpChallengeResponse> {
    const user = await this.userModel.findOne({ email });
    if (!user || user.role !== UserRole.SuperAdmin) {
      if (ip) {
        void this.ipActivityService.log({
          email,
          actionType: 'login_failed',
          ipAddress: ip,
          details: { reason: 'User is not super admin' },
        }).catch(() => {});
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'ACCOUNT_BLOCKED',
        message: 'Your account has been blocked. Please contact support.',
        reason: user.blockedReason ?? null,
      });
    }

    const id = (user._id as Types.ObjectId).toString();

    if (user.totpEnabled) {
      return {
        accountType: 'user',
        requiresTotp: true,
        loginChallenge: this.createLoginChallenge(id, 'user'),
        user: {
          id,
          email: user.email,
          name: user.name,
        },
      };
    }

    return {
      accountType: 'user',
      ...(await this.buildUserSession(user)),
    };
  }

  private async buildUserSession(
    user: UserDocument,
  ): Promise<Omit<UserSuperAdminSessionResponse, 'accountType'>> {
    const id = (user._id as Types.ObjectId).toString();
    const accessToken = this.jwtService.sign({
      sub: id,
      type: 'user',
      email: user.email,
    });

    let assignedAgent: UserSuperAdminSessionResponse['user']['assignedAgent'] =
      null;
    if (user.assignedAgent) {
      const agent = await this.staffUserModel
        .findById(user.assignedAgent)
        .select('fullName email isActive');
      if (agent && agent.isActive) {
        assignedAgent = {
          id: (agent._id as Types.ObjectId).toString(),
          fullName: agent.fullName,
          email: agent.email,
        };
      }
    }

    return {
      accessToken,
      user: {
        id,
        name: user.name,
        email: user.email,
        walletAddress: user.walletAddress,
        referralCode: user.referralCode,
        role: user.role,
        assignedAgent,
      },
    };
  }

  private async findStaffByIdentifier(
    identifier: string,
  ): Promise<StaffUserDocument | null> {
    // +pinHash so buildSession() can report pinSet for super admins.
    if (identifier.includes('@')) {
      return this.staffUserModel.findOne({ email: identifier }).select('+pinHash');
    }
    return this.staffUserModel.findOne({ username: identifier }).select('+pinHash');
  }

  private createLoginChallenge(
    principalId: string,
    principalType: 'staff' | 'user',
  ): string {
    const expiresIn =
      this.configService.get<string>('jwt.loginChallengeExpiresIn') ?? '5m';
    return this.jwtService.sign(
      {
        sub: principalId,
        type: 'login_challenge',
        principalType,
        jti: randomUUID(),
      },
      { expiresIn },
    );
  }
}

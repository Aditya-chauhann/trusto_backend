import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { User, UserDocument, UserRole } from '../../users/schemas/user.schema';
import {
  USER_PIN_FIELDS,
  pinFieldsFor,
  pinSelect,
} from '../../staff/admin-pin.fields';
import {
  StaffUser,
  StaffUserDocument,
} from '../../staff/schemas/staff-user.schema';
import {
  StaffRole,
  StaffRoleDocument,
  StaffTeam,
} from '../../staff/schemas/staff-role.schema';
import { SUPERADMIN_PERMISSION } from '../../staff/permissions.constants';

export type PrincipalType = 'user' | 'staff';

/** Don't rewrite the PIN activity timestamp more than once a minute. */
const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;

export interface JwtPayload {
  sub: string;
  type?: PrincipalType | 'login_challenge';
  principalType?: PrincipalType;
  email?: string;
  username?: string;
  jti?: string;
  /** Super admin PIN session id — see StaffPinService.openPinSession(). */
  pinSid?: string;
}

export interface AuthenticatedRequestUser {
  id: string;
  type: PrincipalType;
  permissions: string[];
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  email?: string;
  name?: string;
  username?: string;
  walletAddress?: string | null;
  referralCode?: string;
  role?: UserRole;
  isBlocked?: boolean;
  isFrozen?: boolean;
  totpEnabled?: boolean;
  totpEnabledAt?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  team?: StaffTeam | null;
  /** Super admins only: whether a PIN has ever been generated. */
  pinSet?: boolean;
  /** Super admins only: whether this token holds a live, unlocked PIN session. */
  pinVerified?: boolean;
  assignedAgent?: {
    id: string;
    fullName: string;
    email: string;
  } | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    @InjectModel(StaffUser.name)
    private readonly staffUserModel: Model<StaffUserDocument>,
    @InjectModel(StaffRole.name)
    private readonly staffRoleModel: Model<StaffRoleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret') ?? 'change-me',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedRequestUser> {
    if (payload.type === 'login_challenge') {
      throw new UnauthorizedException('Invalid token type');
    }

    const type: PrincipalType = payload.type ?? 'user';

    if (type === 'staff') {
      return this.validateStaff(payload.sub, payload.pinSid);
    }
    return this.validateUser(payload.sub, payload.pinSid);
  }

  private async validateUser(
    id: string,
    pinSid?: string,
  ): Promise<AuthenticatedRequestUser> {
    const user = await this.usersService.findById(id);
    if (!user) throw new UnauthorizedException();
    if (user.isBlocked) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'ACCOUNT_BLOCKED',
        message: 'Your account has been blocked. Please contact support.',
        reason: user.blockedReason ?? null,
      });
    }

    const isSuperAdmin = user.role === UserRole.SuperAdmin;

    // Customer accounts can hold the super admin role too (they sign in through
    // /admin/auth/login), so they get the same console PIN gate as staff. The
    // hash is `select: false`, hence the dedicated lookup.
    let pinSet = false;
    let pinVerified = true;
    if (isSuperAdmin) {
      const pinDoc = await this.userModel
        .findById(user._id)
        .select(`${pinSelect('user')} ${USER_PIN_FIELDS.sessionId} ${USER_PIN_FIELDS.lastActivityAt}`);
      pinSet = Boolean(pinDoc?.get(USER_PIN_FIELDS.hash));
      pinVerified = pinDoc
        ? await this.resolvePinSession(pinDoc, 'user', pinSid)
        : false;
    }

    let assignedAgent: AuthenticatedRequestUser['assignedAgent'] = null;
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
      id: (user._id as Types.ObjectId).toString(),
      type: 'user',
      permissions: isSuperAdmin ? [SUPERADMIN_PERMISSION] : [],
      isSuperAdmin,
      mustChangePassword: false,
      email: user.email,
      name: user.name,
      walletAddress: user.walletAddress,
      referralCode: user.referralCode,
      role: user.role,
      isBlocked: user.isBlocked,
      isFrozen: user.isFrozen,
      pinSet,
      pinVerified,
      assignedAgent,
      totpEnabled: !!user.totpEnabled,
      totpEnabledAt: user.totpEnabledAt
        ? user.totpEnabledAt.toISOString()
        : null,
    };
  }

  private async validateStaff(
    id: string,
    pinSid?: string,
  ): Promise<AuthenticatedRequestUser> {
    if (!Types.ObjectId.isValid(id)) {
      throw new UnauthorizedException();
    }
    const staff = await this.staffUserModel.findById(id).select('+pinHash');
    if (!staff) throw new UnauthorizedException();
    if (!staff.isActive) {
      throw new ForbiddenException({
        statusCode: 403,
        errorCode: 'STAFF_INACTIVE',
        message: 'Your staff account has been deactivated.',
      });
    }

    let permissions: string[] = [];
    let roleName: string | null = null;
    let team: StaffTeam | null = null;
    if (staff.isSuperAdmin) {
      permissions = [SUPERADMIN_PERMISSION];
    } else if (staff.roleId) {
      const role = await this.staffRoleModel.findById(staff.roleId);
      if (role && role.isActive) {
        permissions = role.permissions;
        roleName = role.name;
        team = role.team ?? null;
      }
    }

    const pinVerified = staff.isSuperAdmin
      ? await this.resolvePinSession(staff, 'staff', pinSid)
      : true;

    return {
      id: (staff._id as Types.ObjectId).toString(),
      type: 'staff',
      permissions,
      isSuperAdmin: staff.isSuperAdmin,
      mustChangePassword: staff.mustChangePassword,
      email: staff.email,
      username: staff.username,
      name: staff.fullName,
      roleId: staff.roleId ? staff.roleId.toString() : null,
      roleName,
      team,
      totpEnabled: !!staff.totpEnabled,
      totpEnabledAt: staff.totpEnabledAt
        ? staff.totpEnabledAt.toISOString()
        : null,
      pinSet: Boolean(staff.pinHash),
      pinVerified,
    };
  }

  /**
   * Decides whether the token's PIN session is still unlocked, and slides the
   * idle window forward. Returns false once the session is missing, superseded
   * by a newer unlock, or idle for longer than the configured timeout.
   */
  private async resolvePinSession(
    doc: StaffUserDocument | UserDocument,
    type: PrincipalType,
    pinSid?: string,
  ): Promise<boolean> {
    const fields = pinFieldsFor(type);
    const sessionId = doc.get(fields.sessionId) as string | null;
    if (!pinSid || !sessionId || sessionId !== pinSid) {
      return false;
    }

    const model = (
      type === 'staff' ? this.staffUserModel : this.userModel
    ) as Model<StaffUserDocument | UserDocument>;
    const idleMinutes =
      this.config.get<number>('superAdminPin.idleMinutes') ?? 15;
    const idleMs = Math.max(1, idleMinutes) * 60 * 1000;
    const now = Date.now();
    const lastActivity =
      (doc.get(fields.lastActivityAt) as Date | null)?.getTime() ?? 0;

    if (now - lastActivity > idleMs) {
      await model.updateOne(
        { _id: doc._id, [fields.sessionId]: pinSid },
        { $set: { [fields.sessionId]: null, [fields.verifiedAt]: null } },
      );
      return false;
    }

    // Slide the idle window, but write at most once a minute per session.
    if (now - lastActivity > ACTIVITY_WRITE_THROTTLE_MS) {
      await model.updateOne(
        { _id: doc._id, [fields.sessionId]: pinSid },
        { $set: { [fields.lastActivityAt]: new Date(now) } },
      );
    }
    return true;
  }
}

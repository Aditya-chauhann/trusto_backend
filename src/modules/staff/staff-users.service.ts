import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import {
  StaffUser,
  StaffUserDocument,
} from './schemas/staff-user.schema';
import {
  StaffRole,
  StaffRoleDocument,
} from './schemas/staff-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ResetStaffPasswordDto } from './dto/reset-staff-password.dto';

const BCRYPT_ROUNDS = 12;
const AGENT_CODE_PREFIX = 'AGT';
// Unambiguous alphabet (no 0/O, 1/I, etc.) for human-readable agent codes.
const AGENT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const AGENT_CODE_LENGTH = 6;

export interface StaffUserResponse {
  id: string;
  username: string;
  email: string;
  fullName: string;
  agentCode: string | null;
  isActive: boolean;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  role: {
    id: string;
    name: string;
  } | null;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ListStaffOptions {
  page?: number;
  limit?: number;
  search?: string;
  roleId?: string;
  active?: boolean;
}

export interface ListStaffResult {
  items: StaffUserResponse[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class StaffUsersService {
  constructor(
    @InjectModel(StaffUser.name)
    private readonly staffModel: Model<StaffUserDocument>,
    @InjectModel(StaffRole.name)
    private readonly roleModel: Model<StaffRoleDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async create(
    dto: CreateStaffDto,
    createdBy: string,
  ): Promise<StaffUserResponse> {
    const username = dto.username.toLowerCase().trim();
    const email = dto.email.toLowerCase().trim();
    let role: StaffRoleDocument | null = null;
    
    if (dto.isSuperAdmin) {
      if (dto.roleId) {
        throw new BadRequestException('roleId should not be provided for super admins');
      }
    } else {
      if (!dto.roleId) {
        throw new BadRequestException('roleId is required for non-superadmin staff');
      }
      role = await this.roleModel.findById(dto.roleId);
      if (!role) throw new NotFoundException('Role not found');
      if (!role.isActive) {
        throw new BadRequestException('Cannot assign an inactive role');
      }
    }

    const existing = await this.staffModel
      .findOne({ $or: [{ username }, { email }] })
      .select('username email');
    if (existing) {
      if (existing.username === username) {
        throw new ConflictException(
          'A staff user with that username already exists',
        );
      }
      throw new ConflictException(
        'A staff user with that email already exists',
      );
    }

    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new ConflictException('User already exists with this email');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const agentCode = await this.generateUniqueAgentCode();
    const staff = await this.staffModel.create({
      username,
      email,
      passwordHash,
      fullName: dto.fullName.trim(),
      agentCode,
      roleId: role ? role._id : null,
      isSuperAdmin: !!dto.isSuperAdmin,
      isActive: true,
      mustChangePassword: true,
      createdBy: Types.ObjectId.isValid(createdBy)
        ? new Types.ObjectId(createdBy)
        : null,
    });
    return this.toResponse(staff, role);
  }

  async list(opts: ListStaffOptions = {}): Promise<ListStaffResult> {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

    const filter: FilterQuery<StaffUserDocument> = {};
    if (opts.roleId) {
      if (!Types.ObjectId.isValid(opts.roleId)) {
        throw new BadRequestException('Invalid roleId');
      }
      filter.roleId = new Types.ObjectId(opts.roleId);
    }
    if (typeof opts.active === 'boolean') {
      filter.isActive = opts.active;
    }
    if (opts.search && opts.search.trim().length > 0) {
      const escaped = opts.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [{ username: rx }, { email: rx }, { fullName: rx }];
    }

    const [docs, total] = await Promise.all([
      this.staffModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.staffModel.countDocuments(filter),
    ]);

    const roleIds = Array.from(
      new Set(
        docs
          .map((d) => d.roleId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const roles = roleIds.length
      ? await this.roleModel.find({ _id: { $in: roleIds } })
      : [];
    const roleMap = new Map<string, StaffRoleDocument>();
    roles.forEach((r) => roleMap.set((r._id as Types.ObjectId).toString(), r));

    return {
      items: docs.map((d) =>
        this.toResponse(
          d,
          d.roleId ? roleMap.get(d.roleId.toString()) ?? null : null,
        ),
      ),
      total,
      page,
      limit,
    };
  }

  async getById(id: string): Promise<StaffUserResponse> {
    const staff = await this.loadStaff(id);
    const role = staff.roleId
      ? await this.roleModel.findById(staff.roleId)
      : null;
    return this.toResponse(staff, role);
  }

  async getByAgentCode(code: string): Promise<StaffUserResponse> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException('Agent code is required');
    }
    const staff = await this.staffModel.findOne({ agentCode: normalized });
    if (!staff) throw new NotFoundException('Agent not found');
    const role = staff.roleId
      ? await this.roleModel.findById(staff.roleId)
      : null;
    return this.toResponse(staff, role);
  }

  async update(id: string, dto: UpdateStaffDto): Promise<StaffUserResponse> {
    if (
      dto.fullName === undefined &&
      dto.email === undefined &&
      dto.roleId === undefined &&
      dto.isActive === undefined
    ) {
      throw new BadRequestException('No fields to update');
    }
    const staff = await this.loadStaff(id);

    if (dto.fullName !== undefined) {
      const trimmed = dto.fullName.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException('fullName cannot be empty');
      }
      staff.fullName = trimmed;
    }
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase().trim();
      if (email !== staff.email) {
        const dup = await this.staffModel
          .findOne({ email, _id: { $ne: staff._id } })
          .select('_id');
        if (dup) {
          throw new ConflictException(
            'A staff user with that email already exists',
          );
        }
        
        const dupUser = await this.userModel.findOne({ email });
        if (dupUser) {
          throw new ConflictException('User already exists with this email');
        }

        staff.email = email;
      }
    }
    if (dto.isSuperAdmin !== undefined) {
      staff.isSuperAdmin = dto.isSuperAdmin;
      if (staff.isSuperAdmin) {
        staff.roleId = null;
      }
    }

    if (dto.roleId !== undefined) {
      if (staff.isSuperAdmin) {
        throw new BadRequestException('Super admin cannot have a roleId');
      }
      const role = await this.roleModel.findById(dto.roleId);
      if (!role) throw new NotFoundException('Role not found');
      if (!role.isActive) {
        throw new BadRequestException('Cannot assign an inactive role');
      }
      staff.roleId = role._id as Types.ObjectId;
    } else if (!staff.isSuperAdmin && !staff.roleId) {
       throw new BadRequestException('roleId is required for non-superadmin staff');
    }
    if (dto.isActive !== undefined) {
      staff.isActive = dto.isActive;
    }

    await staff.save();
    const role = staff.roleId
      ? await this.roleModel.findById(staff.roleId)
      : null;
    return this.toResponse(staff, role);
  }

  async resetPassword(
    id: string,
    dto: ResetStaffPasswordDto,
  ): Promise<{ ok: true }> {
    const staff = await this.loadStaff(id);
    staff.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    staff.mustChangePassword = true;
    await staff.save();
    return { ok: true };
  }

  async setActive(id: string, isActive: boolean): Promise<StaffUserResponse> {
    const staff = await this.loadStaff(id);
    await this.staffModel.updateOne({ _id: staff._id }, { $set: { isActive } });
    staff.isActive = isActive;
    const role = staff.roleId
      ? await this.roleModel.findById(staff.roleId)
      : null;
    return this.toResponse(staff, role);
  }

  async remove(id: string, currentUserId: string): Promise<void> {
    const staff = await this.loadStaff(id);
    if ((staff._id as Types.ObjectId).toString() === currentUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    await this.userModel.updateMany(
      { assignedAgent: staff._id },
      {
        $set: {
          assignedAgent: null,
          assignedAgentAt: null,
          assignedAgentBy: null,
          assignedAgentSource: null,
        },
      },
    );
    await staff.deleteOne();
  }

  private async generateUniqueAgentCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      let suffix = '';
      for (let i = 0; i < AGENT_CODE_LENGTH; i++) {
        suffix += AGENT_CODE_ALPHABET[randomInt(AGENT_CODE_ALPHABET.length)];
      }
      const code = `${AGENT_CODE_PREFIX}-${suffix}`;
      const exists = await this.staffModel
        .exists({ agentCode: code })
        .exec();
      if (!exists) return code;
    }
    throw new ConflictException(
      'Could not generate a unique agent code, please retry',
    );
  }

  private async loadStaff(id: string): Promise<StaffUserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid staff id');
    }
    const staff = await this.staffModel.findById(id);
    if (!staff) throw new NotFoundException('Staff user not found');
    return staff;
  }

  private toResponse(
    staff: StaffUserDocument,
    role: StaffRoleDocument | null,
  ): StaffUserResponse {
    const ts = staff as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (staff._id as Types.ObjectId).toString(),
      username: staff.username,
      email: staff.email,
      fullName: staff.fullName,
      agentCode: staff.agentCode ?? null,
      isActive: staff.isActive,
      isSuperAdmin: staff.isSuperAdmin,
      mustChangePassword: staff.mustChangePassword,
      role: role
        ? {
            id: (role._id as Types.ObjectId).toString(),
            name: role.name,
          }
        : null,
      lastLoginAt: staff.lastLoginAt ? staff.lastLoginAt.toISOString() : null,
      createdAt: ts.createdAt ? ts.createdAt.toISOString() : null,
      updatedAt: ts.updatedAt ? ts.updatedAt.toISOString() : null,
    };
  }
}

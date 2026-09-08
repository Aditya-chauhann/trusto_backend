import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  StaffRole,
  StaffRoleDocument,
  StaffTeam,
} from './schemas/staff-role.schema';
import {
  StaffUser,
  StaffUserDocument,
} from './schemas/staff-user.schema';
import {
  ALL_PERMISSION_KEYS,
  isValidPermissionKey,
} from './permissions.constants';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

export interface RoleResponse {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
  team: StaffTeam | null;
  memberCount: number;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

@Injectable()
export class StaffRolesService {
  constructor(
    @InjectModel(StaffRole.name)
    private readonly roleModel: Model<StaffRoleDocument>,
    @InjectModel(StaffUser.name)
    private readonly staffModel: Model<StaffUserDocument>,
  ) {}

  async create(dto: CreateRoleDto, createdBy: string): Promise<RoleResponse> {
    const name = dto.name.trim();
    if (name.length === 0) {
      throw new BadRequestException('Role name is required');
    }
    this.validatePermissions(dto.permissions);

    const existing = await this.roleModel
      .findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') })
      .select('_id');
    if (existing) {
      throw new ConflictException('A role with that name already exists');
    }

    const role = await this.roleModel.create({
      name,
      description: (dto.description ?? '').trim(),
      permissions: dto.permissions,
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.team !== undefined ? { team: dto.team } : {}),
      createdBy: Types.ObjectId.isValid(createdBy)
        ? new Types.ObjectId(createdBy)
        : null,
    });
    return this.toResponse(role, 0);
  }

  async list(): Promise<RoleResponse[]> {
    const roles = await this.roleModel.find().sort({ createdAt: -1 });
    if (roles.length === 0) return [];

    const counts = await this.staffModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { roleId: { $in: roles.map((r) => r._id) } } },
      { $group: { _id: '$roleId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map<string, number>();
    counts.forEach((c) => countMap.set(c._id.toString(), c.count));

    return roles.map((r) =>
      this.toResponse(
        r,
        countMap.get((r._id as Types.ObjectId).toString()) ?? 0,
      ),
    );
  }

  async getById(id: string): Promise<RoleResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid role id');
    }
    const role = await this.roleModel.findById(id);
    if (!role) throw new NotFoundException('Role not found');
    const memberCount = await this.staffModel.countDocuments({ roleId: role._id });
    return this.toResponse(role, memberCount);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleResponse> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid role id');
    }
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.permissions === undefined &&
      dto.isActive === undefined &&
      dto.team === undefined
    ) {
      throw new BadRequestException('No fields to update');
    }
    if (dto.permissions !== undefined) {
      this.validatePermissions(dto.permissions);
    }

    const role = await this.roleModel.findById(id);
    if (!role) throw new NotFoundException('Role not found');

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException('Role name cannot be empty');
      }
      if (trimmed.toLowerCase() !== role.name.toLowerCase()) {
        const dup = await this.roleModel
          .findOne({ name: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') })
          .select('_id');
        if (dup && !(dup._id as Types.ObjectId).equals(role._id as Types.ObjectId)) {
          throw new ConflictException('A role with that name already exists');
        }
      }
      role.name = trimmed;
    }
    if (dto.description !== undefined) {
      role.description = dto.description.trim();
    }
    if (dto.permissions !== undefined) {
      role.permissions = dto.permissions;
    }
    if (dto.isActive !== undefined) {
      role.isActive = dto.isActive;
    }
    if (dto.team !== undefined) {
      role.team = dto.team;
    }

    await role.save();
    const memberCount = await this.staffModel.countDocuments({ roleId: role._id });
    return this.toResponse(role, memberCount);
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid role id');
    }
    const role = await this.roleModel.findById(id);
    if (!role) throw new NotFoundException('Role not found');

    const memberCount = await this.staffModel.countDocuments({ roleId: role._id });
    if (memberCount > 0) {
      throw new ConflictException(
        `Cannot delete role while ${memberCount} staff user(s) are assigned to it. Reassign them first.`,
      );
    }
    await role.deleteOne();
  }

  private validatePermissions(perms: string[]): void {
    const invalid = perms.filter((p) => !isValidPermissionKey(p));
    if (invalid.length > 0) {
      throw new BadRequestException({
        message: 'One or more permissions are not recognized',
        invalidPermissions: invalid,
        validPermissions: ALL_PERMISSION_KEYS,
      });
    }
  }

  private toResponse(role: StaffRoleDocument, memberCount: number): RoleResponse {
    const ts = role as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: (role._id as Types.ObjectId).toString(),
      name: role.name,
      description: role.description ?? '',
      permissions: role.permissions,
      isActive: role.isActive,
      team: role.team ?? null,
      memberCount,
      createdBy: role.createdBy ? role.createdBy.toString() : null,
      createdAt: ts.createdAt ? ts.createdAt.toISOString() : null,
      updatedAt: ts.updatedAt ? ts.updatedAt.toISOString() : null,
    };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

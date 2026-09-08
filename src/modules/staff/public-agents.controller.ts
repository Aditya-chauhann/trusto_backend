import { Controller, Get } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  StaffUser,
  StaffUserDocument,
} from './schemas/staff-user.schema';
import {
  StaffRole,
  StaffRoleDocument,
} from './schemas/staff-role.schema';

@Controller('agents')
export class PublicAgentsController {
  constructor(
    @InjectModel(StaffUser.name)
    private readonly staffModel: Model<StaffUserDocument>,
    @InjectModel(StaffRole.name)
    private readonly roleModel: Model<StaffRoleDocument>,
  ) {}

  @Get()
  async list(): Promise<{
    items: Array<{
      id: string;
      fullName: string;
      agentCode: string | null;
      role: string | null;
    }>;
  }> {
    const staff = await this.staffModel
      .find({ isActive: true, isSuperAdmin: { $ne: true } })
      .select('fullName agentCode roleId')
      .sort({ fullName: 1 });

    const roleIds = Array.from(
      new Set(
        staff
          .map((s) => s.roleId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const roles = roleIds.length
      ? await this.roleModel.find({ _id: { $in: roleIds }, isActive: true })
      : [];
    const roleNames = new Map<string, string>();
    roles.forEach((r) =>
      roleNames.set((r._id as Types.ObjectId).toString(), r.name),
    );

    return {
      items: staff.map((s) => ({
        id: (s._id as Types.ObjectId).toString(),
        fullName: s.fullName,
        agentCode: s.agentCode ?? null,
        role: s.roleId ? roleNames.get(s.roleId.toString()) ?? null : null,
      })),
    };
  }
}

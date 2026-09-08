import { IsEnum } from 'class-validator';
import { StaffTeam } from '../../staff/schemas/staff-role.schema';

export class TransferDisputeDto {
  @IsEnum(StaffTeam, {
    message: 'team must be either "support" or "tech"',
  })
  team: StaffTeam;
}

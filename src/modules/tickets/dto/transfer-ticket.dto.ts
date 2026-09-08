import { IsEnum } from 'class-validator';
import { StaffTeam } from '../../staff/schemas/staff-role.schema';

export class TransferTicketDto {
  @IsEnum(StaffTeam, {
    message: 'team must be either "support" or "tech"',
  })
  team: StaffTeam;
}

import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StaffTeam } from '../../staff/schemas/staff-role.schema';

export class CreateStaffTicketDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(140)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(4000)
  description: string;

  @IsEnum(StaffTeam, {
    message: 'team must be either "support" or "tech"',
  })
  team: StaffTeam;
}

import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { StaffTeam } from '../schemas/staff-role.schema';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissions?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsEnum(StaffTeam)
  team?: StaffTeam | null;
}

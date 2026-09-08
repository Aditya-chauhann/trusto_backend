import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import {
  AnnouncementTarget,
  AnnouncementType,
} from '../schemas/announcement.schema';

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsString()
  link?: string;

  @IsEnum(AnnouncementTarget)
  targetAudience: AnnouncementTarget;

  @IsEnum(AnnouncementType)
  type: AnnouncementType;

  @IsISO8601()
  startDate: string;

  @IsISO8601()
  endDate: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

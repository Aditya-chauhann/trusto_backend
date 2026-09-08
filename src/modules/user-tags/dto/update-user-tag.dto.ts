import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ThresholdPeriod } from '../schemas/user-tag.schema';

export class UpdateUserTagDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  rank?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  thresholdAmount?: number;

  @IsOptional()
  @IsEnum(ThresholdPeriod)
  thresholdPeriod?: ThresholdPeriod;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  benefitInr?: number;
}

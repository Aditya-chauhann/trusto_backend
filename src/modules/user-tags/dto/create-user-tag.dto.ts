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

export class CreateUserTagDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  rank: number;

  @IsNumber()
  @Min(0)
  thresholdAmount: number;

  @IsEnum(ThresholdPeriod)
  thresholdPeriod: ThresholdPeriod;

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

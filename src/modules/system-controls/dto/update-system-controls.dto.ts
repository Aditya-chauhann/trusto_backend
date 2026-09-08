import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateSystemControlsDto {
  @IsOptional()
  @IsBoolean()
  depositsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  withdrawalsEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  depositsDisabledReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  withdrawalsDisabledReason?: string;

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  maintenanceMessage?: string;

  /** ISO-8601 timestamp, or null to clear the estimate. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  maintenanceEta?: string | null;
}

import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ApproveWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  txHash?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(25)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'utr must be alphanumeric (no spaces or special characters)',
  })
  utr?: string;
}

export class RejectWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

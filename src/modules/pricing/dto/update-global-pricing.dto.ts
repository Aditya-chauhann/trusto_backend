import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateGlobalPricingDto {
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  usdtPrice?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  inrPrice?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  upiInrPrice?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  feePercent?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  bankFee?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  cryptoFee?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  smartToggleMinUsdt?: number;

  @IsOptional()
  @IsBoolean()
  enableDeposits?: boolean;

  @IsOptional()
  @IsBoolean()
  enableWithdrawals?: boolean;

  @IsOptional()
  @IsBoolean()
  enableBankWithdrawal?: boolean;

  @IsOptional()
  @IsBoolean()
  enableUpiWithdrawal?: boolean;

  @IsOptional()
  @IsBoolean()
  enableSmartUpiWithdrawal?: boolean;

  @IsOptional()
  @IsBoolean()
  enableCryptoWithdrawal?: boolean;

  @IsOptional()
  @IsBoolean()
  enableSweep?: boolean;
}
import { IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';

export class UpdateUserPricingDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  usdtPrice?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  inrPrice?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  upiInrPrice?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  feePercent?: number | null;
}

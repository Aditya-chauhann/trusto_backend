import { IsEnum, IsNumber, IsString, Min } from 'class-validator';

export enum AdjustmentType {
  Credit = 'credit',
  Debit = 'debit',
}

export class AdjustBalanceDto {
  @IsEnum(AdjustmentType)
  type: AdjustmentType;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  remark: string;
}

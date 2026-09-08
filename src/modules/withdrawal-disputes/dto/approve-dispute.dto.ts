import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class ApproveDisputeDto {
  // Amount to adjust on the user's balance, in USDT (always positive).
  @IsNumber()
  @IsPositive()
  amountUsdt: number;

  // 'credit' adds to the balance, 'debit' removes from it.
  @IsEnum(['credit', 'debit'], {
    message: 'direction must be "credit" or "debit"',
  })
  direction: 'credit' | 'debit';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNotes?: string;
}

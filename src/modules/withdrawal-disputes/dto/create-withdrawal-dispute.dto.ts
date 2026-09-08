import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WithdrawalDisputeReason } from '../schemas/withdrawal-dispute.schema';

export class CreateWithdrawalDisputeDto {
  @IsMongoId()
  withdrawalId: string;

  @IsOptional()
  @IsEnum(WithdrawalDisputeReason, {
    message: 'reason must be one of: not_received, wrong_amount, other',
  })
  reason?: WithdrawalDisputeReason;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(4000)
  description: string;
}

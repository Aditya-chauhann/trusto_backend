import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { WithdrawalMethod } from '../schemas/withdrawal.schema';

export class CreateWithdrawalDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pin must be exactly 6 digits' })
  pin: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsEnum(WithdrawalMethod)
  method: WithdrawalMethod;

  @ValidateIf(
    (o: CreateWithdrawalDto) =>
      o.method === WithdrawalMethod.Bank && !o.bankAccountId,
  )
  @IsString()
  @IsNotEmpty()
  accountNumber?: string;

  @ValidateIf(
    (o: CreateWithdrawalDto) =>
      o.method === WithdrawalMethod.Bank && !o.bankAccountId,
  )
  @IsString()
  @IsNotEmpty()
  ifscCode?: string;

  @ValidateIf((o: CreateWithdrawalDto) => o.method === WithdrawalMethod.Bank)
  @IsOptional()
  @IsString()
  bankName?: string;

  @ValidateIf((o: CreateWithdrawalDto) => o.method === WithdrawalMethod.Bank)
  @IsOptional()
  @IsString()
  accountHolderName?: string;

  @ValidateIf((o: CreateWithdrawalDto) => o.method === WithdrawalMethod.Bank)
  @IsOptional()
  @IsMongoId()
  bankAccountId?: string;

  // Optional: an inline UPI handle. When omitted (and no upiAccountId is given),
  // the withdrawal falls back to Smart UPI Selection if the user enabled it —
  // otherwise the service rejects the request. Validated only when present.
  @ValidateIf(
    (o: CreateWithdrawalDto) =>
      o.method === WithdrawalMethod.Upi &&
      o.upiId !== undefined &&
      o.upiId !== null,
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, {
    message: 'upiId must be a valid UPI handle (e.g. name@bank)',
  })
  upiId?: string;

  @ValidateIf((o: CreateWithdrawalDto) => o.method === WithdrawalMethod.Upi)
  @IsOptional()
  @IsMongoId()
  upiAccountId?: string;

  @ValidateIf((o: CreateWithdrawalDto) => o.method === WithdrawalMethod.Crypto)
  @IsString()
  @IsNotEmpty()
  network?: string;

  @ValidateIf((o: CreateWithdrawalDto) => o.method === WithdrawalMethod.Crypto)
  @IsString()
  @IsNotEmpty()
  destinationAddress?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

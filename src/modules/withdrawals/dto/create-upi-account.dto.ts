import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateUpiAccountDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, {
    message: 'upiId must be a valid UPI handle (e.g. name@bank)',
  })
  upiId: string;

  @IsString()
  @IsNotEmpty({ message: 'accountHolderName is required' })
  accountHolderName: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

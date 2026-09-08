import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateUpiRequestDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pin must be exactly 6 digits' })
  pin: string;

  @IsNumber()
  @IsPositive()
  inrAmount: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, {
    message: 'upiId must be a valid UPI handle (e.g. name@bank)',
  })
  upiId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  payeeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  qrPayload?: string;
}

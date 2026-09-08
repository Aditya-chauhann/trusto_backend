import { IsString, Matches } from 'class-validator';

export class SetPinDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pin must be exactly 6 digits' })
  pin: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'confirmPin must be exactly 6 digits' })
  confirmPin: string;
}

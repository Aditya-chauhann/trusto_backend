import { IsString, Matches } from 'class-validator';

export class ResetPinConfirmDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'newPin must be exactly 6 digits' })
  newPin: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'confirmNewPin must be exactly 6 digits' })
  confirmNewPin: string;
}

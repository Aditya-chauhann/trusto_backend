import { IsString, Matches } from 'class-validator';

export class ChangePinDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'currentPin must be exactly 6 digits' })
  currentPin: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'newPin must be exactly 6 digits' })
  newPin: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'confirmNewPin must be exactly 6 digits' })
  confirmNewPin: string;
}

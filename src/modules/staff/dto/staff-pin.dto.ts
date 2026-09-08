import { IsString, Matches } from 'class-validator';

const SIX_DIGITS = /^\d{6}$/;
const PIN_MESSAGE = 'PIN must be exactly 6 digits';

export class SetStaffPinDto {
  @IsString()
  @Matches(SIX_DIGITS, { message: PIN_MESSAGE })
  pin: string;

  @IsString()
  @Matches(SIX_DIGITS, { message: PIN_MESSAGE })
  confirmPin: string;
}

export class VerifyStaffPinDto {
  @IsString()
  @Matches(SIX_DIGITS, { message: PIN_MESSAGE })
  pin: string;
}

export class ChangeStaffPinDto {
  @IsString()
  @Matches(SIX_DIGITS, { message: PIN_MESSAGE })
  currentPin: string;

  @IsString()
  @Matches(SIX_DIGITS, { message: PIN_MESSAGE })
  newPin: string;

  @IsString()
  @Matches(SIX_DIGITS, { message: PIN_MESSAGE })
  confirmNewPin: string;
}

export class ConfirmStaffPinResetDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsString()
  @Matches(SIX_DIGITS, { message: PIN_MESSAGE })
  newPin: string;

  @IsString()
  @Matches(SIX_DIGITS, { message: PIN_MESSAGE })
  confirmNewPin: string;
}

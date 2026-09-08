import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';
import {
  PASSWORD_COMPLEXITY_REGEX,
  PASSWORD_COMPLEXITY_MESSAGE,
} from '../../../common/utils/password-validator.util';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'Code must be a 6-digit number' })
  otp: string;

  @IsString()
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message: PASSWORD_COMPLEXITY_MESSAGE,
  })
  newPassword: string;
}
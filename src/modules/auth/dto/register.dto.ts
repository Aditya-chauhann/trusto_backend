import {
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_COMPLEXITY_REGEX,
  PASSWORD_COMPLEXITY_MESSAGE,
} from '../../../common/utils/password-validator.util';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message:
      'phone must be a valid Indian mobile in +91XXXXXXXXXX format (10 digits starting with 6, 7, 8, or 9)',
  })
  phone: string;

  @IsString()
  @Matches(PASSWORD_COMPLEXITY_REGEX, {
    message: PASSWORD_COMPLEXITY_MESSAGE,
  })
  password: string;

  @IsString()
  confirmPassword: string;

  @IsOptional()
  @IsMongoId()
  assignedAgentId?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsString()
  @IsNotEmpty()
  captchaId: string;

  @IsString()
  @IsNotEmpty()
  captchaAnswer: string;
}

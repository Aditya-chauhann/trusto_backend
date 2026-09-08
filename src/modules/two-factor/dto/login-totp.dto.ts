import { IsString, Matches } from 'class-validator';

export class LoginTotpDto {
  @IsString()
  loginChallenge: string;

  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code: string;
}

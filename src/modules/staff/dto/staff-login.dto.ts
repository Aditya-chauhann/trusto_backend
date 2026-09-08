import { IsNotEmpty, IsString } from 'class-validator';

export class StaffLoginDto {
  /** Email or username (trimmed and lowercased server-side). */
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  captchaId: string;

  @IsString()
  @IsNotEmpty()
  captchaAnswer: string;
}

import { IsString, Matches, MinLength } from 'class-validator';

export class DisableTotpDto {
  @IsString()
  @MinLength(1)
  password: string;

  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code: string;
}

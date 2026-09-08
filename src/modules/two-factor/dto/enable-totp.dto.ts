import { IsString, Matches } from 'class-validator';

export class EnableTotpDto {
  @IsString()
  secret: string;

  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code: string;
}

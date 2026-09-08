import { IsOptional, IsString } from 'class-validator';

export class SetReferralDto {
  @IsOptional()
  @IsString()
  referralCode?: string | null;
}

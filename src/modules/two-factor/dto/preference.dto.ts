import { IsEnum } from 'class-validator';
import { OtpChannel } from '../schemas/otp-challenge.schema';

export class TwoFactorPreferenceDto {
  @IsEnum(OtpChannel)
  method: OtpChannel;
}

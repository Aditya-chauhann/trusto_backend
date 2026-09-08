import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { OtpChannel } from '../schemas/otp-challenge.schema';

export class SendOtpDto {
  @IsOptional()
  @IsEnum(OtpChannel)
  channel?: OtpChannel;

  @ValidateIf((o: SendOtpDto) => o.channel === OtpChannel.Phone)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phone?: string;

  @ValidateIf((o: SendOtpDto) => o.channel === OtpChannel.Email)
  @IsOptional()
  @IsEmail()
  email?: string;
}

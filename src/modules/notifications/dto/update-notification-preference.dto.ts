import { IsEnum } from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @IsEnum(['sms', 'email'], {
    message: 'channel must be either "sms" or "email"',
  })
  channel: 'sms' | 'email';
}

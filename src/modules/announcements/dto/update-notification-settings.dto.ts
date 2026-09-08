import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  depositNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  withdrawalNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  disputeNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  ticketNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  telegramNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  systemAlertsEnabled?: boolean;
}

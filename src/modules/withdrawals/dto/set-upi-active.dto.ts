import { IsBoolean } from 'class-validator';

export class SetUpiActiveDto {
  @IsBoolean()
  isActive: boolean;
}

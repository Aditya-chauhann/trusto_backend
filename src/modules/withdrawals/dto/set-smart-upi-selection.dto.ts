import { IsBoolean } from 'class-validator';

export class SetSmartUpiSelectionDto {
  @IsBoolean()
  enabled: boolean;
}

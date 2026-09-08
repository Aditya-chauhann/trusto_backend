import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ModerationActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

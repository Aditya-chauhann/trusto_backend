import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeclineDisputeDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNotes?: string;
}

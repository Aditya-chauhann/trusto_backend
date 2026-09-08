import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class AssignTagDto {
  @IsMongoId()
  tagId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RemoveTagDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

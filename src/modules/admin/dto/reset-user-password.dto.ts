import { IsOptional, IsString, MinLength } from 'class-validator';

export class AdminResetUserPasswordDto {
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Temporary password must be at least 6 characters long' })
  temporaryPassword?: string;
}

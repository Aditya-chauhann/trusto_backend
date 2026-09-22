import { IsNotEmpty, IsString } from 'class-validator';

export class UpdatePhoneDto {
  @IsNotEmpty({ message: 'Phone number cannot be empty' })
  @IsString()
  phone: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { EmailDto } from './email.dto.js';

export class VerifyEmailDto extends EmailDto {
  @ApiProperty({ example: '048213', description: '6-digit code sent by email' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}

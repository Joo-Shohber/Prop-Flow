import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeEmail, trim } from '../../common/utils/transform.util.js';
import { UserRole } from '../../users/enums/user-role.enum.js';

export class RegisterDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[0-9 ()-]{7,20}$/, {
    message: 'phone must be a valid phone number',
  })
  phone?: string;

  @ApiProperty({ enum: [UserRole.TENANT, UserRole.OWNER] })
  @IsIn([UserRole.TENANT, UserRole.OWNER])
  role: UserRole;
}

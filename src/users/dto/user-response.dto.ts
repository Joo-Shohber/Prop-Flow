import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../enums/user-role.enum.js';

class ImageRefDto {
  @ApiProperty() url!: string;
  @ApiProperty() publicId!: string;
}

export class UserResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() email: string;

  @ApiProperty() firstName: string;

  @ApiProperty() lastName: string;

  @ApiProperty({ nullable: true, type: String }) phone: string | null;

  @ApiProperty({ enum: UserRole }) role: UserRole;

  @ApiProperty({ nullable: true, type: ImageRefDto }) avatar: ImageRefDto | null;

  @ApiProperty() isActive: boolean;

  @ApiProperty() isEmailVerified: boolean;

  @ApiProperty() createdAt: Date;

  @ApiProperty() updatedAt: Date;
}

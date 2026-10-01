import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../enums/user-role.enum.js';

export class UserDirectoryResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() firstName: string;

  @ApiProperty() lastName: string;

  @ApiProperty() email: string;

  @ApiProperty({ enum: UserRole }) role: UserRole;
}

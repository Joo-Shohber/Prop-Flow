import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @ApiProperty({ description: 'false deactivates the account' })
  @IsBoolean()
  isActive!: boolean;
}

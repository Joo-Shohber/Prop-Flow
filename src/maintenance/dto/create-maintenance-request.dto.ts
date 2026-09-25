import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util.js';
import { MaintenanceCategory } from '../enums/maintenance-category.enum.js';
import { MaintenancePriority } from '../enums/maintenance-priority.enum.js';

export class CreateMaintenanceRequestDto {
  @ApiProperty({ maxLength: 150 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiProperty({ enum: MaintenanceCategory })
  @IsEnum(MaintenanceCategory)
  category: MaintenanceCategory;

  @ApiProperty({ enum: MaintenancePriority })
  @IsEnum(MaintenancePriority)
  priority: MaintenancePriority;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { MaintenanceCategory } from '../enums/maintenance-category.enum.js';
import { MaintenancePriority } from '../enums/maintenance-priority.enum.js';
import { MaintenanceStatus } from '../enums/maintenance-status.enum.js';

export class ListMaintenanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MaintenanceStatus })
  @IsOptional()
  @IsEnum(MaintenanceStatus)
  status?: MaintenanceStatus;

  @ApiPropertyOptional({ enum: MaintenancePriority })
  @IsOptional()
  @IsEnum(MaintenancePriority)
  priority?: MaintenancePriority;

  @ApiPropertyOptional({ enum: MaintenanceCategory })
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;
}

import { ApiProperty } from '@nestjs/swagger';
import { MaintenanceCategory } from '../enums/maintenance-category.enum.js';
import { MaintenancePriority } from '../enums/maintenance-priority.enum.js';
import { MaintenanceStatus } from '../enums/maintenance-status.enum.js';

class ImageRefDto {
  @ApiProperty() url: string;
  @ApiProperty() publicId: string;
}

export class MaintenanceResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() title: string;

  @ApiProperty() description: string;

  @ApiProperty({ enum: MaintenanceCategory }) category: MaintenanceCategory;

  @ApiProperty({ enum: MaintenancePriority }) priority: MaintenancePriority;

  @ApiProperty({ type: [ImageRefDto] }) images: ImageRefDto[];

  @ApiProperty() unitId: string;

  @ApiProperty() tenantId: string;

  @ApiProperty({ enum: MaintenanceStatus }) status: MaintenanceStatus;

  @ApiProperty({ nullable: true, type: String }) assignedStaffId: string | null;

  @ApiProperty({ nullable: true, type: String }) scheduledDate: string | null;

  @ApiProperty({ type: [ImageRefDto] }) completionImages: ImageRefDto[];

  @ApiProperty({ nullable: true, type: String }) resolutionDescription:
    string | null;

  @ApiProperty({ nullable: true, type: Date }) resolvedAt: Date | null;

  @ApiProperty() createdAt: Date;

  @ApiProperty() updatedAt: Date;
}

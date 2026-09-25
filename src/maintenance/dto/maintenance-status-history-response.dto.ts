import { ApiProperty } from '@nestjs/swagger';
import { MaintenanceStatus } from '../enums/maintenance-status.enum.js';

export class MaintenanceStatusHistoryResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() requestId: string;

  @ApiProperty({ enum: MaintenanceStatus }) previousStatus: MaintenanceStatus;

  @ApiProperty({ enum: MaintenanceStatus }) newStatus: MaintenanceStatus;

  @ApiProperty() changedById: string;

  @ApiProperty({ nullable: true, type: String }) notes: string | null;

  @ApiProperty() createdAt: Date;
}

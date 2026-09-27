import { ApiProperty } from '@nestjs/swagger';

class MaintenanceCategoryCountDto {
  @ApiProperty() category: string;
  @ApiProperty() count: number;
}

export class DashboardStatsDto {
  @ApiProperty() totalProperties: number;

  @ApiProperty() totalUnits: number;

  @ApiProperty() occupiedUnits: number;

  @ApiProperty() availableUnits: number;

  @ApiProperty({ description: 'Percentage, 0-100' }) occupancyRate: number;

  @ApiProperty() activeLeases: number;

  @ApiProperty() expiredLeases: number;

  @ApiProperty() openMaintenanceRequests: number;

  @ApiProperty() resolvedMaintenanceRequests: number;

  @ApiProperty({ nullable: true, type: Number, description: 'Hours' })
  avgMaintenanceResolutionHours: number | null;

  @ApiProperty({ type: [MaintenanceCategoryCountDto] })
  mostCommonMaintenanceCategories: MaintenanceCategoryCountDto[];
}

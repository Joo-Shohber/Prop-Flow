import { ApiProperty } from '@nestjs/swagger';
import { LeaseStatus } from '../enums/lease-status.enum.js';

export class LeaseResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() tenantId: string;

  @ApiProperty() unitId: string;

  @ApiProperty() startDate: string;

  @ApiProperty() endDate: string;

  @ApiProperty({ enum: LeaseStatus }) status: LeaseStatus;

  @ApiProperty({ nullable: true, type: String }) notes: string | null;

  @ApiProperty() createdAt: Date;

  @ApiProperty() updatedAt: Date;
}

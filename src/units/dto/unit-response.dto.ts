import { ApiProperty } from '@nestjs/swagger';
import { UnitStatus } from '../enums/unit-status.enum.js';

export class UnitResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() unitNumber: string;

  @ApiProperty() building: string;

  @ApiProperty({ nullable: true, type: Number }) floor: number | null;

  @ApiProperty() area: number;

  @ApiProperty() bedrooms: number;

  @ApiProperty() bathrooms: number;

  @ApiProperty({ nullable: true, type: String }) description: string | null;

  @ApiProperty() propertyId: string;

  @ApiProperty({ enum: UnitStatus }) status: UnitStatus;

  @ApiProperty() createdAt: Date;

  @ApiProperty() updatedAt: Date;
}

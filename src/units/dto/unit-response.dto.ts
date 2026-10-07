import { ApiProperty } from '@nestjs/swagger';
import { UnitStatus } from '../enums/unit-status.enum.js';

class ImageRefDto {
  @ApiProperty() url: string;
  @ApiProperty() publicId: string;
  @ApiProperty() source: string;
}

export class UnitResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() unitNumber: string;

  @ApiProperty({ nullable: true, type: Number }) floor: number | null;

  @ApiProperty() area: number;

  @ApiProperty() bedrooms: number;

  @ApiProperty() bathrooms: number;

  @ApiProperty() rentAmount: number;

  @ApiProperty({ nullable: true, type: String }) description: string | null;

  @ApiProperty() propertyId: string;

  @ApiProperty({ enum: UnitStatus }) status: UnitStatus;

  @ApiProperty({ type: [ImageRefDto] }) images: ImageRefDto[];

  @ApiProperty() createdAt: Date;

  @ApiProperty() updatedAt: Date;
}

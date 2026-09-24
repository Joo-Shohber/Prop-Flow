import { ApiProperty } from '@nestjs/swagger';
import { PropertyType } from '../enums/property-type.enum.js';

class ImageRefDto {
  @ApiProperty() url: string;
  @ApiProperty() publicId: string;
}

export class PropertyResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() name: string;

  @ApiProperty({ nullable: true, type: String }) description: string | null;

  @ApiProperty({ enum: PropertyType }) propertyType: PropertyType;

  @ApiProperty() address: string;

  @ApiProperty() city: string;

  @ApiProperty() country: string;

  @ApiProperty() ownerId: string;

  @ApiProperty({ type: [ImageRefDto] }) images: ImageRefDto[];

  @ApiProperty() createdAt: Date;

  @ApiProperty() updatedAt: Date;
}

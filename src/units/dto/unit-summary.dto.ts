import { ApiProperty } from '@nestjs/swagger';

export class UnitSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() unitNumber: string;
  @ApiProperty() propertyId: string;
}

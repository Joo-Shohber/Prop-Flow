import { ApiProperty } from '@nestjs/swagger';
import { PropertyResponseDto } from './property-response.dto.js';
import { UnitResponseDto } from '../../units/dto/unit-response.dto.js';

export class PropertyWithUnitsResponseDto extends PropertyResponseDto {
  @ApiProperty({
    type: UnitResponseDto,
    isArray: true,
  })
  units?: UnitResponseDto[];
}
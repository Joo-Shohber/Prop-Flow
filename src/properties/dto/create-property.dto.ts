import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { trim } from '../../common/utils/transform.util.js';
import { PropertyType } from '../enums/property-type.enum.js';
import { InitialUnitDto } from './initial-unit.dto.js';

export class CreatePropertyDto {
  @ApiProperty({ maxLength: 150 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  description?: string;

  @ApiProperty({ enum: PropertyType })
  @IsEnum(PropertyType)
  propertyType: PropertyType;

  @ApiProperty({ maxLength: 255 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address: string;

  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({
    description:
      'ADMIN only. Ignored when the caller is an OWNER (owner is always self).',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    type: () => InitialUnitDto,
    description:
      'Optional first unit, created with the property in one transaction (used for single-unit types).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => InitialUnitDto)
  unit?: InitialUnitDto;
}

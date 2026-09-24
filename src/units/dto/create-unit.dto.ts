import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trim } from '../../common/utils/transform.util.js';

export class CreateUnitDto {
  @ApiProperty({ maxLength: 50 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unitNumber: string;

  @ApiProperty({ maxLength: 100, description: 'Free-text building label' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  building: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(-2)
  @Max(200)
  floor?: number;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  area: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(50)
  bedrooms: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(50)
  bathrooms: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  description?: string;
}

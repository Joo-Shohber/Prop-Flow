import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { trim } from '../../common/utils/transform.util.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateRentalRequestDto {
  @ApiProperty()
  @IsUUID()
  unitId: string;

  @ApiProperty({ example: '2026-10-15', description: 'Format: YYYY-MM-DD' })
  @Matches(DATE_ONLY, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate: string;

  @ApiProperty({ example: '2027-10-15', description: 'Format: YYYY-MM-DD' })
  @Matches(DATE_ONLY, { message: 'endDate must be in YYYY-MM-DD format' })
  endDate: string;

  @ApiPropertyOptional({ example: 'I would like to rent this unit.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;
}

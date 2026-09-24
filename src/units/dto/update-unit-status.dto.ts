import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { UnitStatus } from '../enums/unit-status.enum.js';

const MANUAL_STATUSES = [UnitStatus.AVAILABLE, UnitStatus.MAINTENANCE] as const;

export class UpdateUnitStatusDto {
  @ApiProperty({
    enum: MANUAL_STATUSES,
    description: 'RENTED can only be set through the lease flow',
  })
  @IsIn(MANUAL_STATUSES)
  status: (typeof MANUAL_STATUSES)[number];
}

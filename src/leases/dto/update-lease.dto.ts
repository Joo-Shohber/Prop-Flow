import { PartialType, PickType } from '@nestjs/swagger';
import { CreateLeaseDto } from './create-lease.dto.js';

export class UpdateLeaseDto extends PartialType(
  PickType(CreateLeaseDto, ['startDate', 'endDate', 'notes'] as const),
) {}

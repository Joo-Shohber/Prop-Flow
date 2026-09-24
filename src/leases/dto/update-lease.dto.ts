import { PartialType, PickType } from '@nestjs/swagger';
import { CreateLeaseDto } from './create-lease.dto.js';

/** Only while PENDING. tenantId/unitId are not editable — cancel and recreate instead. */
export class UpdateLeaseDto extends PartialType(
  PickType(CreateLeaseDto, ['startDate', 'endDate', 'notes'] as const),
) {}

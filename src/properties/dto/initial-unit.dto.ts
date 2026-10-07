import {
  IntersectionType,
  OmitType,
  PartialType,
  PickType,
} from '@nestjs/swagger';
import { CreateUnitDto } from '../../units/dto/create-unit.dto.js';

export class InitialUnitDto extends IntersectionType(
  OmitType(CreateUnitDto, ['unitNumber'] as const),
  PartialType(PickType(CreateUnitDto, ['unitNumber'] as const)),
) {}

import { PartialType } from '@nestjs/swagger';
import { CreateUnitDto } from './create-unit.dto.js';

export class UpdateUnitDto extends PartialType(CreateUnitDto) {}

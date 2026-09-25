import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trim } from '../../common/utils/transform.util.js';
import { TransitionNotesDto } from './transition-notes.dto.js';

export class CompleteMaintenanceDto extends TransitionNotesDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  resolutionDescription: string;
}

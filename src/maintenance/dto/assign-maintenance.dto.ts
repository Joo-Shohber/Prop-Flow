import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { TransitionNotesDto } from './transition-notes.dto.js';

export class AssignMaintenanceDto extends TransitionNotesDto {
  @ApiProperty()
  @IsUUID()
  assignedStaffId: string;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;
}

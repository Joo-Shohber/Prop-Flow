import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { RentalRequestStatus } from '../enums/rental-request-status.enum.js';

export class ListRentalRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RentalRequestStatus })
  @IsOptional()
  @IsEnum(RentalRequestStatus)
  status?: RentalRequestStatus;

  @ApiPropertyOptional({ description: 'Filter by unit' })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}

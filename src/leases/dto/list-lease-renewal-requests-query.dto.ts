import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { LeaseRenewalRequestStatus } from '../enums/lease-renewal-request-status.enum.js';

export class ListLeaseRenewalRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeaseRenewalRequestStatus })
  @IsOptional()
  @IsEnum(LeaseRenewalRequestStatus)
  status?: LeaseRenewalRequestStatus;

  @ApiPropertyOptional({ description: 'Filter by lease' })
  @IsOptional()
  @IsUUID()
  leaseId?: string;
}

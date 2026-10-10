import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnitSummaryDto } from '../../units/dto/unit-summary.dto.js';
import type { LeaseRenewalRequest } from '../entities/lease-renewal-request.entity.js';
import { LeaseRenewalRequestStatus } from '../enums/lease-renewal-request-status.enum.js';
import { LeaseStatus } from '../enums/lease-status.enum.js';

export class RenewalRequestTenantSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ nullable: true, type: String }) phone: string | null;
}

export class RenewalRequestLeaseSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() startDate: string;
  @ApiProperty({ description: 'The lease end date right now' }) endDate: string;
  @ApiProperty({ enum: LeaseStatus }) status: LeaseStatus;
  @ApiProperty() rentAmount: number;
}

export class LeaseRenewalRequestResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() leaseId: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() requestedEndDate: string;
  @ApiProperty({ nullable: true, type: String }) message: string | null;
  @ApiProperty({ enum: LeaseRenewalRequestStatus })
  status: LeaseRenewalRequestStatus;
  @ApiPropertyOptional({ type: RenewalRequestTenantSummaryDto })
  tenant?: RenewalRequestTenantSummaryDto;
  @ApiPropertyOptional({ type: RenewalRequestLeaseSummaryDto })
  lease?: RenewalRequestLeaseSummaryDto;
  @ApiPropertyOptional({ type: UnitSummaryDto }) unit?: UnitSummaryDto;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static fromEntity(
    entity: LeaseRenewalRequest,
  ): LeaseRenewalRequestResponseDto {
    const dto = new LeaseRenewalRequestResponseDto();
    dto.id = entity.id;
    dto.leaseId = entity.leaseId;
    dto.tenantId = entity.tenantId;
    dto.requestedEndDate = entity.requestedEndDate;
    dto.message = entity.message;
    dto.status = entity.status;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    if (entity.tenant) {
      dto.tenant = {
        id: entity.tenant.id,
        firstName: entity.tenant.firstName,
        lastName: entity.tenant.lastName,
        phone: entity.tenant.phone,
      };
    }
    if (entity.lease) {
      dto.lease = {
        id: entity.lease.id,
        startDate: entity.lease.startDate,
        endDate: entity.lease.endDate,
        status: entity.lease.status,
        rentAmount: entity.lease.rentAmount,
      };
      if (entity.lease.unit) {
        dto.unit = {
          id: entity.lease.unit.id,
          unitNumber: entity.lease.unit.unitNumber,
          propertyId: entity.lease.unit.propertyId,
        };
      }
    }
    return dto;
  }
}

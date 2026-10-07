import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { RentalRequest } from '../entities/rental-request.entity.js';
import { RentalRequestStatus } from '../enums/rental-request-status.enum.js';

export class RentalRequestTenantSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ nullable: true, type: String }) phone: string | null;
}

export class RentalRequestUnitSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() unitNumber: string;
  @ApiProperty() propertyId: string;
  @ApiProperty() rentAmount: number;
}

export class RentalRequestResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() unitId: string;
  @ApiProperty() startDate: string;
  @ApiProperty() endDate: string;
  @ApiProperty({ nullable: true, type: String }) message: string | null;
  @ApiProperty({ enum: RentalRequestStatus }) status: RentalRequestStatus;
  @ApiProperty() rentAmount: number;
  @ApiPropertyOptional({ type: RentalRequestTenantSummaryDto })
  tenant?: RentalRequestTenantSummaryDto;
  @ApiPropertyOptional({ type: RentalRequestUnitSummaryDto })
  unit?: RentalRequestUnitSummaryDto;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static fromEntity(entity: RentalRequest): RentalRequestResponseDto {
    const dto = new RentalRequestResponseDto();
    dto.id = entity.id;
    dto.tenantId = entity.tenantId;
    dto.unitId = entity.unitId;
    dto.startDate = entity.startDate;
    dto.endDate = entity.endDate;
    dto.message = entity.message;
    dto.status = entity.status;
    dto.rentAmount = entity.rentAmount;
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
    if (entity.unit) {
      dto.unit = {
        id: entity.unit.id,
        unitNumber: entity.unit.unitNumber,
        propertyId: entity.unit.propertyId,
        rentAmount: entity.unit.rentAmount,
      };
    }
    return dto;
  }
}

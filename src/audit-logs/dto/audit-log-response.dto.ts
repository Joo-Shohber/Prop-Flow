import { ApiProperty } from '@nestjs/swagger';
import { AuditAction } from '../enums/audit-action.enum.js';

export class AuditLogResponseDto {
  @ApiProperty() id: string;

  @ApiProperty() userId: string;

  @ApiProperty({ enum: AuditAction }) action: AuditAction;

  @ApiProperty() entity: string;

  @ApiProperty() entityId: string;

  @ApiProperty({ nullable: true, type: Object }) metadata: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String }) ipAddress: string | null;

  @ApiProperty() createdAt: Date;
}

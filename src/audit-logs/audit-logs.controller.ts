import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditLogResponseDto } from './dto/audit-log-response.dto.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Roles(UserRole.ADMIN)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List audit log entries ADMIN' })
  @ApiOkResponse({
    type: AuditLogResponseDto,
    isArray: true,
    description: 'Paginated list; see meta',
  })
  findAll(@Query() query: ListAuditLogsQueryDto) {
    return this.auditLogs.findAll(query);
  }
}

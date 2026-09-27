import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { User } from '../users/entities/user.entity.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { AnalyticsService } from './analytics.service.js';
import { DashboardStatsDto } from './dto/dashboard-stats.dto.js';

@ApiTags('Analytics')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@Roles(UserRole.OWNER, UserRole.ADMIN)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Dashboard statistics (OWNER: own properties, ADMIN: system-wide)',
  })
  @ApiOkResponse({ type: DashboardStatsDto })
  @ApiForbiddenResponse({ description: 'Requires OWNER or ADMIN' })
  getDashboard(@CurrentUser() actor: User): Promise<DashboardStatsDto> {
    return this.analytics.getDashboard(actor);
  }
}

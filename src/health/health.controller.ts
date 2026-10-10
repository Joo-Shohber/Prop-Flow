import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { HealthReport, HealthService } from './health.service.js';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Readiness check (PostgreSQL and Redis)',
    description:
      'Returns 200 when every dependency answers, otherwise 503 with the failing checks in `details`. `GET /` stays a plain liveness response.',
  })
  @ApiOkResponse({ description: 'All dependencies are up' })
  @ApiServiceUnavailableResponse({
    description: 'At least one dependency is down',
  })
  async check(): Promise<HealthReport> {
    const report = await this.healthService.check();

    if (report.status === 'down') {
      throw new ServiceUnavailableException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'One or more dependencies are down',
        details: Object.entries(report.checks)
          .filter(([, probe]) => probe.status === 'down')
          .map(([name]) => `${name}: down`),
      });
    }

    return report;
  }
}

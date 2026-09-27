import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

const UNITS_SEARCH_PATTERN = 'units:search:*';
const DASHBOARD_STATS_PATTERN = 'dashboard:stats:*';

@Injectable()
export class CacheInvalidationService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Unit changes, and lease activation/termination/expiration.
   */
  async invalidateUnitsAndDashboard(): Promise<void> {
    await Promise.all([
      this.redis.delByPattern(UNITS_SEARCH_PATTERN),
      this.redis.delByPattern(DASHBOARD_STATS_PATTERN),
    ]);
  }

  /**
   *  Property changes, and maintenance status changes.
   */
  async invalidateDashboard(): Promise<void> {
    await this.redis.delByPattern(DASHBOARD_STATS_PATTERN);
  }
}

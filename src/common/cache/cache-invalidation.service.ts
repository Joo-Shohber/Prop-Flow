import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';

const UNITS_SEARCH_PATTERN = 'units:search:*';
const DASHBOARD_STATS_PATTERN = 'dashboard:stats:*';

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Unit changes, and lease activation/termination/expiration.
   */
  async invalidateUnitsAndDashboard(): Promise<void> {
    await this.safely('units + dashboard', () =>
      Promise.all([
        this.redis.delByPattern(UNITS_SEARCH_PATTERN),
        this.redis.delByPattern(DASHBOARD_STATS_PATTERN),
      ]),
    );
  }

  /**
   * Property changes, and maintenance status changes.
   */
  async invalidateDashboard(): Promise<void> {
    await this.safely('dashboard', () =>
      this.redis.delByPattern(DASHBOARD_STATS_PATTERN),
    );
  }

  private async safely(
    label: string,
    op: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await op();
    } catch (error) {
      this.logger.error(
        `Cache invalidation failed (${label}); entries stay stale until TTL: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

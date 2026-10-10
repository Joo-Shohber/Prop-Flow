import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheInvalidationService } from '../cache/cache-invalidation.service.js';

interface ExpirationResult {
  expiredLeases: number;
  releasedUnits: number;
}

const EXPIRE_LEASES = `
  WITH expired AS (
    UPDATE leases
    SET status = 'EXPIRED', "updatedAt" = now()
    WHERE status = 'ACTIVE' AND "endDate" < CURRENT_DATE
    RETURNING id, "unitId"
  ),
  cancelled_renewals AS (
    UPDATE lease_renewal_requests
    SET status = 'CANCELLED', "updatedAt" = now()
    WHERE status = 'PENDING' AND "leaseId" IN (SELECT id FROM expired)
  ),
  released AS (
    UPDATE units
    SET status = 'AVAILABLE', "updatedAt" = now()
    WHERE id IN (SELECT "unitId" FROM expired) AND status = 'RENTED'
    RETURNING id
  )
  SELECT
    (SELECT count(*) FROM expired)::int  AS "expiredLeases",
    (SELECT count(*) FROM released)::int AS "releasedUnits"
`;

@Injectable()
export class LeaseExpirationService {
  private readonly logger = new Logger(LeaseExpirationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CacheInvalidationService,
  ) {}

  async run(): Promise<void> {
    const [{ expiredLeases, releasedUnits }] =
      await this.dataSource.query<ExpirationResult[]>(EXPIRE_LEASES);

    if (expiredLeases > 0) {
      this.logger.log(
        `Expired ${expiredLeases} overdue lease(s), released ${releasedUnits} unit(s)`,
      );
      await this.cache.invalidateUnitsAndDashboard();
    }
  }
}

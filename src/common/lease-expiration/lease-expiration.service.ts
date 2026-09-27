import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheInvalidationService } from '../cache/cache-invalidation.service.js';

@Injectable()
export class LeaseExpirationService {
  private readonly logger = new Logger(LeaseExpirationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: CacheInvalidationService,
  ) {}

  async run(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let expiredCount = 0;

    try {
      const [expired] = await runner.query(`
        UPDATE leases
        SET status = 'EXPIRED', "updatedAt" = now()
        WHERE status = 'ACTIVE' AND "endDate" < CURRENT_DATE
        RETURNING "unitId"
      `);
      expiredCount = expired.length;

      if (expired.length) {
        const unitIds = expired.map((row: { unitId: string }) => row.unitId);
        await runner.query(`
          UPDATE units
          SET status = 'AVAILABLE', "updatedAt" = now()
          WHERE id = ANY($1::uuid[])`,
          [unitIds],
        );
      }

      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    if (expiredCount) {
      this.logger.log(`Expired ${expiredCount} overdue lease(s)`);
      await this.cache.invalidateUnitsAndDashboard();
    }
  }
}

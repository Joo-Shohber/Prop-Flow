import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class LeaseExpirationService {
  private readonly logger = new Logger(LeaseExpirationService.name);

  constructor(private readonly dataSource: DataSource) {}

  async run(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const [expired] = await runner.query(`
        UPDATE leases
        SET status = 'EXPIRED', "updatedAt" = now()
        WHERE status = 'ACTIVE' AND "endDate" < CURRENT_DATE
        RETURNING "unitId"
      `);

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
      if (expired.length) {
        this.logger.log(`Expired ${expired.length} overdue lease(s)`);
        // Cache invalidation (units search / dashboard stats) is added in Phase 8.
      }
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}

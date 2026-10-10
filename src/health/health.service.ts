import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../common/redis/redis.service.js';

const PROBE_TIMEOUT_MS = 2000;

export type ProbeStatus = 'up' | 'down';

export interface ProbeResult {
  status: ProbeStatus;
  latencyMs: number;
}

export interface HealthReport {
  status: 'ok' | 'down';
  uptimeSeconds: number;
  checks: { database: ProbeResult; redis: ProbeResult };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  /**
   * Checks the dependencies the API cannot work without: PostgreSQL and Redis.
   * Each probe is bounded by a timeout so a hung dependency cannot hang the
   * health check itself.
   * @returns The overall status and the result of each probe.
   */
  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      this.probe(() => this.dataSource.query('SELECT 1')),
      this.probe(() => this.redis.client.ping()),
    ]);

    return {
      status: database.status === 'up' && redis.status === 'up' ? 'ok' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, redis },
    };
  }

  private async probe(run: () => Promise<unknown>): Promise<ProbeResult> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('probe timed out')),
            PROBE_TIMEOUT_MS,
          );
        }),
      ]);

      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch {
      return { status: 'down', latencyMs: Date.now() - startedAt };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

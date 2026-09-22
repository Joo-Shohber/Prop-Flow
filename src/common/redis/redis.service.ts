import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get<string>('REDIS_HOST'),
      port: this.config.get<number>('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: 3,
    });

    this.client.on('ready', () => this.logger.log('Redis connected'));
    this.client.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  async delByPattern(pattern: string): Promise<void> {
    const stream = this.client.scanStream({ match: pattern, count: 100 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length) await this.client.del(...keys);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

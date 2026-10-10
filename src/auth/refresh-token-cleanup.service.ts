import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RedisService } from '../common/redis/redis.service.js';
import { RefreshToken } from './entities/refresh-token.entity.js';

const CLEANUP_LOCK_KEY = 'maintenance:refresh-token-cleanup';
const CLEANUP_INTERVAL_SECONDS = 60 * 60;

@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  constructor(
    private readonly redis: RedisService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  /**
   * Removes expired refresh tokens if the hourly lock can be acquired.
   * Errors are logged and swallowed so a login never fails because of cleanup.
   */
  async clean(): Promise<void> {
    try {
      const acquired = await this.redis.client.set(
        CLEANUP_LOCK_KEY,
        '1',
        'EX',
        CLEANUP_INTERVAL_SECONDS,
        'NX',
      );

      if (acquired !== 'OK') return;

      try {
        const { affected } = await this.refreshTokens.delete({
          expiresAt: LessThan(new Date()),
        });

        if (affected) {
          this.logger.log(`Deleted ${affected} expired refresh tokens`);
        }
      } catch (error) {
        await this.redis.del(CLEANUP_LOCK_KEY).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      this.logger.warn(
        `Refresh token cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

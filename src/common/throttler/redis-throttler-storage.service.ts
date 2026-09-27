import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from '../redis/redis.service.js';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';

const THROTTLE_SCRIPT = `
local requestCountKey = KEYS[1]
local blockStatusKey = KEYS[2]
local windowTtlMs = tonumber(ARGV[1])
local requestLimit = tonumber(ARGV[2])
local blockDurationMs = tonumber(ARGV[3])

local blockTtlMs = redis.call('PTTL', blockStatusKey)

if blockTtlMs > 0 then
  local requestCount = tonumber(redis.call('GET', requestCountKey) or '0')
  local windowTtlRemainingMs = redis.call('PTTL', requestCountKey)

  return { requestCount, windowTtlRemainingMs, 1, blockTtlMs }
end

local requestCount = redis.call('INCR', requestCountKey)

if requestCount == 1 then
  redis.call('PEXPIRE', requestCountKey, windowTtlMs)
end

local windowTtlRemainingMs = redis.call('PTTL', requestCountKey)

if requestCount > requestLimit then
  if blockDurationMs > 0 then
    redis.call('SET', blockStatusKey, '1', 'PX', blockDurationMs )
    return { requestCount, windowTtlRemainingMs, 1, blockDurationMs }
  end

  return { requestCount, windowTtlRemainingMs, 1, 0 }
end

return { requestCount, windowTtlRemainingMs, 0, 0 }`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:{${throttlerName}:${key}}:hits`;
    const blockKey = `throttle:{${throttlerName}:${key}}:block`;

    const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] =
      (await this.redis.client.eval(
        THROTTLE_SCRIPT,
        2,
        hitsKey,
        blockKey,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];

    return {
      totalHits,
      timeToExpire: Math.ceil(timeToExpireMs / 1000),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: Math.ceil(timeToBlockExpireMs / 1000),
    };
  }
}

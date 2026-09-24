import { createHmac, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../common/redis/redis.service.js';
import { OtpPurpose } from './enums/otp-purpose.enum.js';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from './constants/otp.constants.js';

// Atomically verifies an OTP using a Redis Lua script.
const VERIFY_SCRIPT = `
local data = redis.call('HMGET', KEYS[1], 'hash', 'attempts')
if not data[1] then return 'MISSING' end
if data[1] == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 'OK'
end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return 'LOCKED'
end
return 'INVALID'
`;

@Injectable()
export class OtpService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Generates and stores a new OTP for the specified purpose and email.
   * @param purpose The purpose of the OTP, such as email verification or password reset.
   * @param email The email address associated with the OTP.
   * @returns The generated OTP, or null if the resend cooldown is active.
   */
  async issue(purpose: OtpPurpose, email: string): Promise<string | null> {
    const client = this.redis.client;

    const cooldown = await client.set(
      this.cooldownKey(purpose, email),
      '1',
      'EX',
      OTP_RESEND_COOLDOWN_SECONDS,
      'NX',
    );

    if (cooldown !== 'OK') return null;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const key = this.key(purpose, email);

    await client
      .multi()
      .del(key)
      .hset(key, { hash: this.hash(purpose, email, code), attempts: 0 })
      .expire(key, OTP_TTL_SECONDS)
      .exec();

    return code;
  }

  /**
   * Verifies an OTP for the specified purpose and email useing Lua script.
   * @param purpose The purpose of the OTP.
   * @param email The email address associated with the OTP.
   * @param code The OTP code provided by the user.
   * @returns True only when the code is correct, unexpired, and unused.
   */
  async verify(
    purpose: OtpPurpose,
    email: string,
    code: string,
  ): Promise<boolean> {
    const result = await this.redis.client.eval(
      VERIFY_SCRIPT,
      1,
      this.key(purpose, email),
      this.hash(purpose, email, code),
      OTP_MAX_ATTEMPTS,
    );

    return result === 'OK';
  }

  private hash(purpose: OtpPurpose, email: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('OTP_SECRET'))
      .update(`${purpose}:${email}:${code}`)
      .digest('hex');
  }

  private key(purpose: OtpPurpose, email: string): string {
    return `otp:${purpose}:${email}`;
  }

  private cooldownKey(purpose: OtpPurpose, email: string): string {
    return `otp:cooldown:${purpose}:${email}`;
  }
}

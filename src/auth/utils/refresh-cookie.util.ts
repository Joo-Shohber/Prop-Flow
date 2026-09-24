import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { durationToSeconds } from '../../common/utils/duration.util.js';
import {
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
} from '../constants/auth.constants.js';

function baseCookieOptions(config: ConfigService): CookieOptions {
  const production = config.get<string>('NODE_ENV') === 'production';

  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: REFRESH_TOKEN_COOKIE_PATH,
  };
}

export function setRefreshTokenCookie(
  res: Response,
  token: string,
  config: ConfigService,
): void {
  const maxAge =
    durationToSeconds(config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN')) * 1000;
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookieOptions(config),
    maxAge,
  });
}

export function clearRefreshTokenCookie(
  res: Response,
  config: ConfigService,
): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions(config));
}

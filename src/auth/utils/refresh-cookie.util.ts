import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { durationToSeconds } from '../../common/utils/duration.util.js';
import {
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
} from '../auth.constants.js';

// sameSite 'none' (cross-domain frontend) requires secure:true unconditionally —
// the browser drops the cookie otherwise. Needs HTTPS even locally.
function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: REFRESH_TOKEN_COOKIE_PATH,
  };
}

export function setRefreshTokenCookie(
  res: Response,
  token: string,
  config: ConfigService,
): void {
  const maxAge =
    durationToSeconds(config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN')) *
    1000;
  res.cookie(REFRESH_TOKEN_COOKIE, token, { ...baseCookieOptions(), maxAge });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions());
}

import type { CookieOptions, Request, Response } from 'express';
import type { IssuedRefreshToken } from './refresh-token.service';

export const REFRESH_COOKIE_NAME = 'sentinel_refresh';
/** The cookie is only ever sent to the refresh endpoint (which also handles logout via DELETE). */
export const REFRESH_COOKIE_PATH = '/v1/auth/refresh';

const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
};

export function setRefreshCookie(res: Response, refreshToken: IssuedRefreshToken): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken.token, { ...REFRESH_COOKIE_OPTIONS, expires: refreshToken.expiresAt });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
}

export function readRefreshCookie(req: Request): string | undefined {
  // Populated by cookie-parser (see main.ts).
  const value: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

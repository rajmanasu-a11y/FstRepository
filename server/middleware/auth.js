import crypto from 'node:crypto';
import { config } from '../config.js';
import { forbidden, unauthorized, AppError } from '../lib/errors.js';
import { resolveSession, SESSION_COOKIE } from '../services/sessions.js';

export function sessionCookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

/** Attach req.user when a valid session cookie is present. */
export async function loadSession(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const result = await resolveSession(token);
  if (result?.user) {
    req.user = result.user;
  } else {
    req.sessionExpired = Boolean(result?.expired);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(req.sessionExpired
      ? new AppError(401, 'SESSION_EXPIRED', 'Your session has expired due to inactivity. Please sign in again.')
      : unauthorized('Please sign in to continue.'));
  }
  next();
}

export const can = (req, code) => Boolean(req.user?.permissions?.has(code));
export const canAny = (req, codes) => codes.some((c) => can(req, c));

/** Require at least one of the given permissions. */
export function requirePermission(...codes) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized('Please sign in to continue.'));
    if (!canAny(req, codes)) return next(forbidden());
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection: the session cookie is SameSite=Strict, and every
 * state-changing request from an authenticated session must echo the
 * per-session token in the X-CSRF-Token header. Cross-origin requests are
 * rejected outright when the browser supplies an Origin header.
 */
export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    const host = req.get('host');
    let originHost = null;
    try { originHost = new URL(origin).host; } catch { /* invalid origin */ }
    if (!originHost || originHost !== host) return next(forbidden('Cross-origin requests are not permitted.'));
  }
  if (!req.user) return next();
  const sent = req.get('x-csrf-token') || '';
  const expected = req.user.csrfToken;
  const ok = sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return next(forbidden('Security token missing or invalid. Please reload the page and try again.'));
  next();
}

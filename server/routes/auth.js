import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { AppError, validationError } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { checkPasswordPolicy, dummyVerify, hashPassword, verifyPassword } from '../lib/passwords.js';
import { audit, auditContext } from '../services/audit.js';
import { createSession, revokeSession, revokeUserSessions, SESSION_COOKIE, resolveSession } from '../services/sessions.js';
import { getSetting } from '../services/settings.js';
import { clientSettings, publicBranding, userPayload } from '../services/bootstrap.js';
import { requireAuth, sessionCookieOptions } from '../middleware/auth.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.loginRateLimitPerWindow,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait a few minutes and try again.' } },
});

const INVALID = 'The username or password is incorrect.';

authRouter.get('/branding', async (_req, res) => {
  res.json(await publicBranding());
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = parse(z.object({
    username: z.string({ error: 'Username is required' }).trim().min(1, 'Username is required').max(60),
    password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(200),
  }), req.body);
  const sec = await getSetting('security');
  const ctx = auditContext(req);

  const { rows } = await query(
    `SELECT u.id, u.username::text, u.password_hash, u.is_active, u.failed_login_count, u.locked_until,
            u.locked_until > now() AS is_locked, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.username = $1 AND u.deleted_at IS NULL`,
    [body.username],
  );
  const user = rows[0];
  if (!user) {
    await dummyVerify(body.password);
    await audit({ ...ctx, username: body.username }, { action: 'LOGIN_FAILED', entityType: 'user', summary: 'Unknown username' });
    throw new AppError(401, 'INVALID_CREDENTIALS', INVALID);
  }
  if (user.is_locked) {
    await audit({ ...ctx, userId: user.id, username: user.username, roleCode: user.role_code },
      { action: 'LOGIN_BLOCKED', entityType: 'user', entityId: user.id, summary: 'Account locked' });
    throw new AppError(423, 'ACCOUNT_LOCKED',
      'This account is temporarily locked after repeated unsuccessful sign-in attempts. Please try again later or contact the system administrator.');
  }
  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok || !user.is_active) {
    const max = Number(sec.maxLoginAttempts) || 5;
    const lockMinutes = Number(sec.lockoutMinutes) || 15;
    const { rows: upd } = await query(
      `UPDATE users SET failed_login_count = failed_login_count + 1,
              locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
        WHERE id = $1 RETURNING failed_login_count, locked_until`,
      [user.id, max, lockMinutes],
    );
    await audit({ ...ctx, userId: user.id, username: user.username, roleCode: user.role_code }, {
      action: 'LOGIN_FAILED', entityType: 'user', entityId: user.id,
      summary: !user.is_active ? 'Inactive account' : `Invalid password (attempt ${upd[0].failed_login_count})`,
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', INVALID);
  }

  await query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  const session = await createSession(user.id, { ip: req.ip, userAgent: req.get('user-agent') });
  res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.maxAgeMs));
  await audit({ ...ctx, userId: user.id, username: user.username, roleCode: user.role_code },
    { action: 'LOGIN', entityType: 'user', entityId: user.id, summary: 'Signed in' });

  const resolved = await resolveSession(session.token);
  res.json({ user: userPayload(resolved.user), csrfToken: session.csrfToken, settings: await clientSettings() });
});

authRouter.post('/logout', async (req, res) => {
  if (req.user) {
    await revokeSession(req.user.sessionId);
    await audit(auditContext(req), { action: 'LOGOUT', entityType: 'user', entityId: req.user.id, summary: 'Signed out' });
  }
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.json({ ok: true, message: 'You have been signed out successfully.' });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: userPayload(req.user), csrfToken: req.user.csrfToken, settings: await clientSettings() });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const body = parse(z.object({
    currentPassword: z.string().min(1, 'Current password is required').max(200),
    newPassword: z.string().min(1, 'New password is required').max(200),
    confirmPassword: z.string().min(1, 'Please confirm the new password').max(200),
  }), req.body);
  if (body.newPassword !== body.confirmPassword) throw validationError({ confirmPassword: 'Passwords do not match' });
  const policyError = checkPasswordPolicy(body.newPassword, await getSetting('security'));
  if (policyError) throw validationError({ newPassword: policyError });

  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (!(await verifyPassword(body.currentPassword, rows[0].password_hash))) {
      throw validationError({ currentPassword: 'The current password is incorrect' });
    }
    if (await verifyPassword(body.newPassword, rows[0].password_hash)) {
      throw validationError({ newPassword: 'The new password must be different from the current password' });
    }
    await client.query(
      'UPDATE users SET password_hash = $2, must_change_password = FALSE, password_changed_at = now(), updated_by = $1 WHERE id = $1',
      [req.user.id, await hashPassword(body.newPassword)],
    );
    await audit(auditContext(req), { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: req.user.id, summary: 'Password changed' }, client);
  });
  await revokeUserSessions(req.user.id, req.user.sessionId);
  res.json({ ok: true, message: 'Your password has been changed successfully.' });
});

import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { getSetting } from './settings.js';

export const SESSION_COOKIE = 'vms_sid';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

const permissionCache = new Map();
const PERM_TTL_MS = 30_000;

export async function rolePermissions(roleId) {
  const hit = permissionCache.get(roleId);
  if (hit && Date.now() - hit.at < PERM_TTL_MS) return hit.perms;
  const { rows } = await query(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`,
    [roleId],
  );
  const perms = new Set(rows.map((r) => r.code));
  permissionCache.set(roleId, { perms, at: Date.now() });
  return perms;
}

export function clearPermissionCache() {
  permissionCache.clear();
}

export async function createSession(userId, { ip, userAgent }) {
  const sec = await getSetting('security');
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const hours = Number(sec.absoluteSessionHours) || 12;
  await query(
    `INSERT INTO user_sessions (token_hash, csrf_token, user_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))`,
    [sha256(token), csrfToken, userId, ip || null, userAgent?.slice(0, 300) || null, hours],
  );
  return { token, csrfToken, maxAgeMs: hours * 3600 * 1000 };
}

/**
 * Resolve a session token. Returns { user } for a valid session,
 * { expired: true } when the session exists but has timed out, or null.
 */
export async function resolveSession(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const sec = await getSetting('security');
  const idleMinutes = Number(sec.sessionTimeoutMinutes) || 30;
  const { rows } = await query(
    `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at, s.expires_at, s.revoked_at,
            (s.revoked_at IS NULL AND s.expires_at > now()
               AND s.last_seen_at > now() - make_interval(mins => $2)) AS is_valid,
            (now() - s.last_seen_at) > interval '60 seconds' AS needs_touch,
            u.id, u.username::text, u.full_name, u.email::text, u.employee_id, u.is_active, u.deleted_at,
            u.must_change_password, r.id AS role_id, r.code AS role_code, r.name AS role_name
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = $1`,
    [sha256(token), idleMinutes],
  );
  const row = rows[0];
  if (!row) return null;
  if (!row.is_valid || !row.is_active || row.deleted_at) {
    if (!row.revoked_at) await query('UPDATE user_sessions SET revoked_at = now() WHERE id = $1', [row.session_id]);
    return { expired: true };
  }
  if (row.needs_touch) {
    await query('UPDATE user_sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
  }
  return {
    user: {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      email: row.email,
      employeeId: row.employee_id,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      mustChangePassword: row.must_change_password,
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
      permissions: await rolePermissions(row.role_id),
    },
  };
}

export async function revokeSession(sessionId) {
  await query('UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
}

export async function revokeUserSessions(userId, exceptSessionId = null) {
  await query(
    'UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)',
    [userId, exceptSessionId],
  );
}

export async function purgeOldSessions() {
  await query(`DELETE FROM user_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`);
}

import { query } from '../db/pool.js';

/** Build an audit context from an Express request (or a system job). */
export function auditContext(req) {
  if (!req) return { system: true };
  return {
    userId: req.user?.id ?? null,
    username: req.user?.username ?? null,
    roleCode: req.user?.roleCode ?? null,
    ip: req.ip ?? null,
    userAgent: req.get?.('user-agent')?.slice(0, 300) ?? null,
  };
}

export const SYSTEM_CONTEXT = { userId: null, username: 'system', roleCode: 'SYSTEM', ip: null, userAgent: null };

const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'password_hash', 'token', 'csrfToken']);

function scrub(obj) {
  if (!obj || typeof obj !== 'object') return obj ?? null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

/** Return only the keys whose values differ, as {old, new} pairs. */
export function diff(before, after) {
  const oldValues = {};
  const newValues = {};
  for (const key of Object.keys(after || {})) {
    const a = before?.[key];
    const b = after[key];
    const norm = (x) => (x instanceof Date ? x.toISOString() : x === undefined ? null : JSON.stringify(x));
    if (norm(a) !== norm(b)) {
      oldValues[key] = a ?? null;
      newValues[key] = b ?? null;
    }
  }
  return { oldValues, newValues, changed: Object.keys(newValues).length > 0 };
}

/**
 * Write an audit record. Pass the transaction client so the audit entry
 * commits (or rolls back) together with the change it describes.
 */
export async function audit(ctx, entry, client = null) {
  const c = ctx?.system ? SYSTEM_CONTEXT : ctx || SYSTEM_CONTEXT;
  const runner = client || { query };
  await runner.query(
    `INSERT INTO audit_logs (user_id, username, role_code, action, entity_type, entity_id, entity_ref, summary,
                             old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      c.userId, c.username, c.roleCode, entry.action, entry.entityType ?? null,
      entry.entityId != null ? String(entry.entityId) : null, entry.entityRef ?? null, entry.summary ?? null,
      entry.oldValues ? JSON.stringify(scrub(entry.oldValues)) : null,
      entry.newValues ? JSON.stringify(scrub(entry.newValues)) : null,
      c.ip, c.userAgent,
    ],
  );
}

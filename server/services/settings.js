import { query } from '../db/pool.js';

// Settings are read on almost every request; cache briefly. The TTL bounds
// staleness when several application instances share one database.
const TTL_MS = 15_000;
let cache = null;
let loadedAt = 0;

export async function getAllSettings() {
  if (cache && Date.now() - loadedAt < TTL_MS) return cache;
  const { rows } = await query('SELECT key, value FROM system_settings');
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  loadedAt = Date.now();
  return cache;
}

export async function getSetting(key) {
  const all = await getAllSettings();
  return all[key] ?? {};
}

export function invalidateSettings() {
  cache = null;
}

export async function orgTimezone() {
  return (await getSetting('organisation')).timezone || 'UTC';
}

export async function updateSetting(client, key, value, userId) {
  const { rows } = await client.query('SELECT value FROM system_settings WHERE key = $1 FOR UPDATE', [key]);
  const previous = rows[0]?.value ?? null;
  await client.query(
    `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
  );
  invalidateSettings();
  return previous;
}

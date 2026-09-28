import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate({ reset = false, log = console.log } = {}) {
  const client = await pool.connect();
  try {
    if (reset) {
      log('[migrate] resetting schema public');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    // Serialise concurrent migration runs (e.g. several app instances booting).
    await client.query('SELECT pg_advisory_lock(7263001)');
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      log(`[migrate] applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(7263001)');
    log('[migrate] database is up to date');
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

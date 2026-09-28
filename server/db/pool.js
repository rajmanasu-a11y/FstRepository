import pg from 'pg';
import { config } from '../config.js';

// Return BIGINT (int8) and NUMERIC as JS numbers; our values stay well within
// Number.MAX_SAFE_INTEGER. DATE columns are returned as 'YYYY-MM-DD' strings so
// they are never shifted by the server's local time zone.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // All sessions work in UTC; conversion to the organisation time zone is
  // explicit in SQL (AT TIME ZONE) and in the UI.
  // pg_trgm word-similarity threshold used for typo-tolerant name search.
  options: '-c timezone=UTC -c pg_trgm.word_similarity_threshold=0.45',
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run fn inside a transaction. The callback receives a dedicated client.
 * Serialization failures / deadlocks are retried a few times, which keeps
 * concurrent reception desks from surfacing spurious errors.
 */
export async function withTransaction(fn, { isolation = 'READ COMMITTED', retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if ((err.code === '40001' || err.code === '40P01') && attempt < retries) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

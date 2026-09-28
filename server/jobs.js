import { withTransaction } from './db/pool.js';
import { markOverstays } from './services/visits.js';
import { dispatchPending } from './services/notifications.js';
import { purgeOldSessions } from './services/sessions.js';
import { purgeUnattachedUploads } from './services/files.js';
import { getSetting } from './services/settings.js';

/**
 * Lightweight in-process scheduler. Each job is guarded so a failure is
 * logged and retried on the next tick rather than crashing the server; the
 * overstay job uses a PostgreSQL advisory lock so that only one instance
 * processes it when the application is scaled horizontally.
 */
export function startJobs({ log = console } = {}) {
  const timers = [];
  const every = (ms, name, fn) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await fn(); } catch (err) { log.error(`[job:${name}]`, err.message); } finally { running = false; }
    };
    timers.push(setInterval(tick, ms));
    setTimeout(tick, 2000);
  };
  every(60_000, 'overstay', async () => {
    const flagged = await withTransaction((client) => markOverstays(client));
    if (flagged.length) log.log(`[job:overstay] flagged ${flagged.length} visit(s)`);
    await dispatchPending();
  });
  every(30_000, 'notifications', () => dispatchPending());
  every(6 * 3600_000, 'housekeeping', async () => {
    await purgeOldSessions();
    const r = await getSetting('retention');
    await purgeUnattachedUploads(Number(r.deleteUnattachedUploadsAfterHours) || 24);
  });
  return () => timers.forEach(clearInterval);
}

import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { startJobs } from './jobs.js';

async function main() {
  if (process.env.AUTO_MIGRATE !== 'false') await migrate({ log: (m) => console.log(m) });
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`[vms] Visitor Management System listening on http://${config.host}:${config.port} (${config.env})`);
  });
  const stopJobs = config.backgroundJobs ? startJobs() : () => {};
  const shutdown = (signal) => {
    console.log(`[vms] ${signal} received, shutting down`);
    stopJobs();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[vms] failed to start:', err);
  process.exit(1);
});

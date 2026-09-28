// Boots a freshly migrated and seeded instance for end-to-end tests.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = process.env.E2E_DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgres://vms:vms@localhost:5432/vms_test';
process.env.STORAGE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-e2e-storage-'));
process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${process.env.E2E_PORT || 3100}`;
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.API_RATE_LIMIT = '100000';

const { migrate } = await import('../../server/db/migrate.js');
const { seed } = await import('../../server/db/seed.js');
const { createApp } = await import('../../server/app.js');
const { startJobs } = await import('../../server/jobs.js');

await migrate({ reset: true, log: () => {} });
await seed({ force: true, log: () => {} });
const port = Number(process.env.E2E_PORT || 3100);
createApp().listen(port, '127.0.0.1', () => console.log(`[e2e] server on ${port}`));
startJobs({ log: { log() {}, error: console.error } });

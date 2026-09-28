import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOGIN_RATE_LIMIT = '3';
const { setup, teardown, Client } = await import('./_helpers.js');

before(setup);
after(teardown);

test('the sign-in endpoint is rate limited per client', async () => {
  const c = new Client();
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await c.login('admin', 'wrong')).status);
  assert.deepEqual(statuses.slice(0, 3), [401, 401, 401]);
  assert.equal(statuses[3], 429);
  const r = await c.login('admin', 'wrong');
  assert.match(r.data.error.message, /Too many sign-in attempts/);
});

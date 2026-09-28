import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, loginAs, query } from './_helpers.js';

before(setup);
after(teardown);

test('unexpected errors show a generic message; the technical detail is logged securely', async () => {
  const { errorHandler, GENERIC_ERROR } = await import('../../server/middleware/errors.js');
  let status;
  let body;
  const res = { headersSent: false, status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  await errorHandler(new Error('relation "secret_table" does not exist'), { method: 'GET', originalUrl: '/api/x', user: null }, res, () => {});
  assert.equal(status, 500);
  assert.equal(body.error.message, GENERIC_ERROR);
  assert.equal(GENERIC_ERROR, 'Unable to complete the request. Please try again or contact the system administrator.');
  assert.ok(!JSON.stringify(body).includes('secret_table'), 'no SQL detail reaches the user');
  const { rows } = await query('SELECT message FROM error_logs WHERE reference = $1', [body.error.reference]);
  assert.match(rows[0].message, /secret_table/);
});

test('database constraint errors are translated into professional messages', async () => {
  const { fromDatabaseError } = await import('../../server/lib/errors.js');
  const e = fromDatabaseError({ code: '23505', constraint: 'visits_one_active_per_visitor' });
  assert.equal(e.status, 409);
  assert.match(e.message, /already checked in/);
  const unknown = fromDatabaseError({ code: '23505', constraint: 'something_else' });
  assert.equal(unknown.message, 'A record with the same details already exists.');
});

test('malformed JSON and unknown API routes return clean errors', async () => {
  const c = await loginAs('reception');
  const bad = await c.request('POST', '/visits', { body: '{"visit":', headers: {} });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error.message, 'The request could not be read.');
  const nf = await c.get('/no-such-endpoint');
  assert.equal(nf.status, 404);
  assert.equal(nf.data.error.code, 'NOT_FOUND');
  const badId = await c.get('/visits/not-a-real-key!');
  assert.equal(badId.status, 404);
});

test('success messages use professional wording', async () => {
  const c = await loginAs('superadmin');
  const r = await c.put('/settings/security', {
    sessionTimeoutMinutes: 30, absoluteSessionHours: 12, passwordMinLength: 10, passwordRequireComplexity: true,
    maxLoginAttempts: 5, lockoutMinutes: 15, showContactOnEmergencyList: true, maskMobileInPrint: true,
  });
  assert.equal(r.data.message, 'Settings have been saved successfully.');
  const { rows } = await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'SETTINGS_CHANGED' AND entity_ref = 'security'`);
  assert.equal(rows[0].n, 1, 'settings changes are audited');
});

test('invalid settings are rejected by server-side validation', async () => {
  const c = await loginAs('superadmin');
  const r = await c.put('/settings/visitor', { defaultDurationMinutes: 600, maxDurationMinutes: 60 });
  assert.equal(r.status, 422);
});

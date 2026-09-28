import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, Client, loginAs, query, PASSWORD } from './_helpers.js';

before(setup);
after(teardown);

test('valid login returns the user, permissions and a CSRF token; session cookie is HttpOnly + SameSite=Strict', async () => {
  const c = new Client();
  const res = await c.request('POST', '/auth/login', { body: { username: 'reception', password: PASSWORD }, raw: true });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /vms_sid=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  const body = await res.json();
  assert.equal(body.user.roleCode, 'RECEPTION');
  assert.ok(body.user.permissions.includes('visit.checkin'));
  assert.ok(body.csrfToken.length > 20);
  assert.equal(body.user.password_hash, undefined);
});

test('invalid login gives a generic message and is audited', async () => {
  const c = new Client();
  const bad = await c.login('reception', 'wrong-password');
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error.message, 'The username or password is incorrect.');
  const unknown = await c.login('no-such-user', 'whatever');
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error.message, bad.data.error.message, 'unknown user and wrong password are indistinguishable');
  const { rows } = await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'LOGIN_FAILED'`);
  assert.ok(rows[0].n >= 2);
});

test('account locks after repeated failures and can be unlocked by the super administrator', async () => {
  const c = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await c.login('reception2', 'bad')).status, 401);
  const locked = await c.login('reception2', PASSWORD);
  assert.equal(locked.status, 423);
  assert.match(locked.data.error.message, /temporarily locked/);
  const admin = await loginAs('superadmin');
  const { rows } = await query(`SELECT id FROM users WHERE username = 'reception2'`);
  assert.equal((await admin.post(`/users/${rows[0].id}/unlock`, {})).status, 200);
  assert.equal((await c.login('reception2', PASSWORD)).status, 200);
});

test('logout revokes the server-side session', async () => {
  const c = await loginAs('security');
  assert.equal((await c.get('/auth/me')).status, 200);
  const cookie = c.cookie;
  assert.equal((await c.post('/auth/logout', {})).status, 200);
  const replay = new Client();
  replay.cookie = cookie;
  assert.equal((await replay.get('/auth/me')).status, 401);
});

test('sessions expire after the configured inactivity timeout', async () => {
  const c = await loginAs('admin');
  assert.equal((await c.get('/dashboard/summary')).status, 200);
  await query(`UPDATE user_sessions SET last_seen_at = now() - interval '2 hours' WHERE user_id = (SELECT id FROM users WHERE username = 'admin')`);
  const r = await c.get('/dashboard/summary');
  assert.equal(r.status, 401);
  assert.equal(r.data.error.code, 'SESSION_EXPIRED');
});

test('unauthenticated API access is refused', async () => {
  const anon = new Client();
  for (const url of ['/visitors/search?q=ramesh', '/visits/current', '/reports/daily', '/audit-logs', '/settings', '/files/photos/00000000-0000-0000-0000-000000000000']) {
    assert.equal((await anon.get(url)).status, 401, url);
  }
});

test('state-changing requests require the CSRF token and a same-origin Origin', async () => {
  const c = await loginAs('reception');
  const noToken = await c.request('POST', '/visits/1/check-out', { body: {}, csrf: false });
  assert.equal(noToken.status, 403);
  assert.match(noToken.data.error.message, /Security token/);
  const wrongToken = await c.request('POST', '/visits/1/check-out', { body: {}, csrf: false, headers: { 'X-CSRF-Token': 'x'.repeat(32) } });
  assert.equal(wrongToken.status, 403);
  const crossOrigin = await c.request('POST', '/visits/1/check-out', { body: {}, headers: { Origin: 'https://evil.example' } });
  assert.equal(crossOrigin.status, 403);
});

test('password change enforces the password policy and revokes other sessions', async () => {
  const c = await loginAs('priya.sharma');
  const other = await loginAs('priya.sharma');
  const weak = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short', confirmPassword: 'short' });
  assert.equal(weak.status, 422);
  assert.match(weak.data.error.fields.newPassword, /at least 10 characters/);
  const wrongCurrent = await c.post('/auth/change-password', { currentPassword: 'nope', newPassword: 'N3w-Password!2026', confirmPassword: 'N3w-Password!2026' });
  assert.equal(wrongCurrent.status, 422);
  const ok = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'N3w-Password!2026', confirmPassword: 'N3w-Password!2026' });
  assert.equal(ok.status, 200);
  assert.equal((await other.get('/auth/me')).status, 401, 'other sessions are revoked');
  assert.equal((await c.get('/auth/me')).status, 200, 'current session continues');
  const { rows } = await query(`SELECT password_hash FROM users WHERE username = 'priya.sharma'`);
  assert.match(rows[0].password_hash, /^scrypt\$/);
  assert.ok(!rows[0].password_hash.includes('N3w-Password'));
});

test('users with a temporary password can do nothing except change it', async () => {
  const admin = await loginAs('superadmin');
  const created = await admin.post('/users', { username: 'temp.user', fullName: 'Temporary User', roleCode: 'RECEPTION', password: 'Temp@Pass2026x' });
  assert.equal(created.status, 201);
  const u = new Client();
  assert.equal((await u.login('temp.user', 'Temp@Pass2026x')).status, 200);
  const blocked = await u.get('/visits/current');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await u.post('/auth/change-password', { currentPassword: 'Temp@Pass2026x', newPassword: 'Better@Pass2026', confirmPassword: 'Better@Pass2026' })).status, 200);
  assert.equal((await u.get('/visits/current')).status, 200);
});

test('security headers are present on every response', async () => {
  const res = await fetch(`${(await import('./_helpers.js')).baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('x-frame-options'));
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

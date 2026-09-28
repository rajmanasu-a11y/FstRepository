import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, loginAs, ids, query, visitBody } from './_helpers.js';

let i;
before(async () => { await setup(); i = await ids(); });
after(teardown);

const expectStatus = async (client, method, url, status, body) => {
  const r = await client.request(method, url, body !== undefined ? { body } : {});
  assert.equal(r.status, status, `${method} ${url} expected ${status}, got ${r.status}: ${JSON.stringify(r.data)?.slice(0, 200)}`);
  return r;
};

test('reception: operational access only', async () => {
  const c = await loginAs('reception');
  await expectStatus(c, 'GET', '/visitors/search?q=ramesh', 200);
  await expectStatus(c, 'GET', '/visits/current', 200);
  await expectStatus(c, 'GET', '/reports/daily', 403);
  await expectStatus(c, 'GET', '/reports/daily/export?format=csv', 403);
  await expectStatus(c, 'GET', '/audit-logs', 403);
  await expectStatus(c, 'GET', '/settings', 403);
  await expectStatus(c, 'PUT', '/settings/security', 403, { sessionTimeoutMinutes: 999 });
  await expectStatus(c, 'POST', '/users', 403, { username: 'x', fullName: 'X Y', roleCode: 'SUPER_ADMIN', password: 'A@aaaaaaaa1' });
  await expectStatus(c, 'POST', '/employees', 403, { employeeCode: 'X1', fullName: 'X Y', designation: 'Z', departmentId: 1 });
  await expectStatus(c, 'PUT', `/visitors/${i.ramesh}/watchlist`, 403, { status: 'BLOCKED', reason: 'test' });
});

test('administrator: can view reports but cannot export, manage users or read audit logs', async () => {
  const c = await loginAs('admin');
  await expectStatus(c, 'GET', '/reports/daily', 200);
  await expectStatus(c, 'GET', '/reports/daily/export?format=pdf', 403);
  await expectStatus(c, 'GET', '/reports/audit', 403);
  await expectStatus(c, 'GET', '/users', 403);
  await expectStatus(c, 'GET', '/audit-logs', 403);
  await expectStatus(c, 'POST', '/employees', 201, { employeeCode: 'EMP-9001', fullName: 'Test Host', designation: 'Officer', departmentId: 1 });
});

test('security officer: verify, on-premises, emergency; no registration or reports', async () => {
  const c = await loginAs('security');
  await expectStatus(c, 'GET', '/visits/current', 200);
  await expectStatus(c, 'GET', '/reports/emergency', 200);
  await expectStatus(c, 'GET', '/reports/on-premises', 200);
  await expectStatus(c, 'GET', '/reports/daily', 403);
  await expectStatus(c, 'POST', '/visits', 403, visitBody(i));
  const { rows } = await query(`SELECT p.pass_number FROM visitor_passes p JOIN visits v ON v.id = p.visit_id WHERE v.status = 'CHECKED_IN' LIMIT 1`);
  const v = await expectStatus(c, 'GET', `/verify/${rows[0].pass_number}`, 200);
  assert.equal(v.data.verdict.valid, true);
});

test('host: sees only own visitors and approves only own requests (no role escalation)', async () => {
  const host = await loginAs('rajesh.kumar');
  const mine = await expectStatus(host, 'GET', '/visits?pageSize=500', 200);
  assert.ok(mine.data.items.length > 0);
  assert.ok(mine.data.items.every((v) => v.host.id === i.rajesh), 'only own visits are listed');
  const { rows: others } = await query('SELECT id FROM visits WHERE host_employee_id <> $1 LIMIT 1', [i.rajesh]);
  await expectStatus(host, 'GET', `/visits/${others[0].id}`, 404);
  await expectStatus(host, 'GET', '/visitors/search?q=ramesh', 403);
  await expectStatus(host, 'GET', `/visitors/${i.ramesh}`, 403);
  await expectStatus(host, 'GET', '/visits/current', 403);
  await expectStatus(host, 'GET', '/reports/emergency', 403);
  // Pending approval for another host cannot be decided by Rajesh.
  const { rows: pending } = await query(`SELECT id FROM visits WHERE status = 'PENDING_APPROVAL' AND host_employee_id <> $1 LIMIT 1`, [i.rajesh]);
  const denied = await expectStatus(host, 'POST', `/visits/${pending[0].id}/decision`, 403, { decision: 'APPROVE' });
  assert.match(denied.data.error.message, /only approve visitors who are coming to meet you/);
  // Host users cannot create users or change their own role.
  await expectStatus(host, 'POST', '/users', 403, { username: 'evil', fullName: 'Evil User', roleCode: 'SUPER_ADMIN', password: 'Aa1!aaaaaaaa' });
  await expectStatus(host, 'PUT', '/users/1', 403, { fullName: 'X', roleCode: 'SUPER_ADMIN' });
});

test('host pre-registration is always for themselves, even if another host is requested', async () => {
  const host = await loginAs('rajesh.kumar');
  const r = await expectStatus(host, 'POST', '/pre-registration', 201, {
    visitor: { fullName: 'Guest Of Rajesh', mobileNumber: '9123412341' },
    visit: { hostEmployeeId: i.priya, purposeId: i.official, appointmentDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) },
  });
  assert.equal(r.data.visit.host.id, i.rajesh);
  assert.equal(r.data.visit.status, 'EXPECTED');
  assert.ok(r.data.visit.visitCode.startsWith('VST-'));
});

test('super administrator cannot demote or deactivate their own account', async () => {
  const c = await loginAs('superadmin');
  const { rows } = await query(`SELECT id FROM users WHERE username = 'superadmin'`);
  const r = await expectStatus(c, 'PUT', `/users/${rows[0].id}`, 409, { fullName: 'System Super Administrator', roleCode: 'RECEPTION' });
  assert.match(r.data.error.message, /own role/);
});

test('role changes take effect immediately (sessions are revoked)', async () => {
  const admin = await loginAs('superadmin');
  const victim = await loginAs('reception2');
  const { rows } = await query(`SELECT id FROM users WHERE username = 'reception2'`);
  await expectStatus(admin, 'PUT', `/users/${rows[0].id}`, 200, { fullName: 'Farida Begum', roleCode: 'SECURITY' });
  assert.equal((await victim.get('/auth/me')).status, 401);
});

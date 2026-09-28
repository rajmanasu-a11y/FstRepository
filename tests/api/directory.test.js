import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, loginAs, query } from './_helpers.js';

let admin;
before(async () => { await setup(); admin = await loginAs('admin'); });
after(teardown);

test('host search returns name, designation and department (for automatic display)', async () => {
  const r = await admin.get('/employees?q=rajesh');
  const e = r.data.items[0];
  assert.equal(e.displayName, 'Mr. Rajesh Kumar');
  assert.equal(e.designation, 'Manager – Administration');
  assert.equal(e.departmentName, 'Administration');
  const byDept = await admin.get('/employees?q=finance');
  assert.ok(byDept.data.items.length >= 3);
  assert.ok(byDept.data.items.every((x) => x.departmentName === 'Finance' || /financ/i.test(x.designation)));
  const fuzzy = await admin.get('/employees?q=Rajsh');
  assert.equal(fuzzy.data.items[0].fullName, 'Rajesh Kumar');
});

test('host master: create, validate, update (audited), deactivate', async () => {
  const bad = await admin.post('/employees', { employeeCode: '', fullName: '1', designation: '', departmentId: '' });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.error.fields.employeeCode && bad.data.error.fields.fullName && bad.data.error.fields.designation && bad.data.error.fields.departmentId);
  const c = await admin.post('/employees', { employeeCode: 'emp-2001', salutation: 'Ms.', fullName: 'Rekha Iyer', designation: 'Deputy Manager – HR', departmentId: 3, officialEmail: 'REKHA@x.example' });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.employee.employeeCode, 'EMP-2001');
  const dup = await admin.post('/employees', { employeeCode: 'EMP-2001', fullName: 'Someone Else', designation: 'X Y', departmentId: 3 });
  assert.equal(dup.status, 409);
  const u = await admin.put(`/employees/${c.data.employee.id}`, { employeeCode: 'EMP-2001', salutation: 'Ms.', fullName: 'Rekha Iyer', designation: 'Manager – HR', departmentId: 3, isActive: false });
  assert.equal(u.status, 200);
  const { rows } = await query(`SELECT old_values, new_values FROM audit_logs WHERE action = 'HOST_MODIFIED' AND entity_id = $1`, [String(c.data.employee.id)]);
  assert.equal(rows[0].old_values.designation, 'Deputy Manager – HR');
  assert.equal(rows[0].new_values.designation, 'Manager – HR');
  const active = await admin.get('/employees?q=rekha');
  assert.equal(active.data.items.length, 0, 'inactive hosts are not offered for selection');
});

test('company directory: autocomplete, duplicate names prevented, inline creation reuses existing names', async () => {
  const r = await admin.get('/companies?q=abc&compact=true');
  assert.equal(r.data.items[0].name, 'ABC Technologies Pvt. Ltd.');
  const dup = await admin.post('/companies', { name: '  abc   technologies pvt. ltd. ' });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error.message, /already exists/);
  const c = await admin.post('/companies', { name: 'Horizon Metals Ltd', website: 'www.horizon.example', category: 'Vendor' });
  assert.equal(c.status, 201);
  const badWeb = await admin.post('/companies', { name: 'Another Co', website: 'not a site' });
  assert.equal(badWeb.status, 422);
});

test('configurable masters: categories, purposes, access areas can be added and edited', async () => {
  const sa = await loginAs('superadmin');
  assert.equal((await admin.post('/masters/purposes', { code: 'X', name: 'Blocked' })).status, 403, 'admin cannot manage masters');
  const p = await sa.post('/masters/purposes', { code: 'site visit', name: 'Site Visit', sortOrder: 150 });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal(p.data.item.code, 'SITE_VISIT');
  const e = await sa.put(`/masters/purposes/${p.data.item.id}`, { isActive: false });
  assert.equal(e.data.item.isActive, false);
  const m = await admin.get('/masters');
  assert.ok(!m.data.purposes.some((x) => x.code === 'SITE_VISIT'), 'inactive masters hidden from forms');
  const cat = await sa.post('/masters/categories', { code: 'AUDITOR', name: 'External Auditor', requiresApproval: true, rollCallGroup: 'VISITOR' });
  assert.equal(cat.status, 201);
});

test('settings: visitor rules and print templates are validated and applied', async () => {
  const sa = await loginAs('superadmin');
  const t = await sa.put('/settings/print-templates/VISITOR_PASS', { widthMm: 86, heightMm: 54, paper: 'BADGE', showPhoto: true, showQr: true, headerColor: '#123456', instruction: 'Wear this pass at all times.' });
  assert.equal(t.status, 200);
  const me = await sa.get('/auth/me');
  assert.equal(me.data.settings.print.VISITOR_PASS.widthMm, 86);
  const bad = await sa.put('/settings/print-templates/VISITOR_PASS', { widthMm: 5, heightMm: 54, paper: 'BADGE', showPhoto: true, showQr: true, headerColor: 'red', instruction: 'x' });
  assert.equal(bad.status, 422);
});

test('data retention: preview and apply (archive / anonymise, restricted visitors kept)', async () => {
  const sa = await loginAs('superadmin');
  await query(`UPDATE visitors SET last_visit_at = now() - interval '2000 days' WHERE full_name IN ('Asha Kiran', 'Sameer Khan')`);
  await query(`UPDATE visits SET status = 'CANCELLED' WHERE visitor_id = (SELECT id FROM visitors WHERE full_name = 'Asha Kiran') AND status = 'EXPECTED'`);
  const p = await sa.get('/retention/preview');
  assert.ok(p.data.toAnonymise >= 1);
  assert.equal((await sa.post('/retention/run', {})).status, 422, 'explicit confirmation required');
  const r = await sa.post('/retention/run', { confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const { rows } = await query(`SELECT full_name, mobile_number, record_status FROM visitors WHERE id = (SELECT visitor_id FROM visits WHERE status = 'CANCELLED' AND visitor_id IN (SELECT id FROM visitors WHERE record_status = 'ANONYMISED') LIMIT 1)`);
  assert.equal(rows[0].full_name, 'Anonymised Visitor');
  assert.equal(rows[0].mobile_number, null);
  const blocked = await query(`SELECT record_status FROM visitors WHERE full_name = 'Sameer Khan'`);
  assert.notEqual(blocked.rows[0].record_status, 'ANONYMISED', 'restricted visitors are retained');
  const vis = await query(`SELECT count(*)::int AS n FROM visits v JOIN visitors x ON x.id = v.visitor_id WHERE x.record_status = 'ANONYMISED'`);
  assert.ok(vis.rows[0].n >= 1, 'visit records retained for statistics');
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, loginAs, ids, query, visitBody, newMobile } from './_helpers.js';

let i;
let rec;
before(async () => { await setup(); i = await ids(); rec = await loginAs('reception'); });
after(teardown);

test('returning visitor search by mobile shows the complete summary (spec example)', async () => {
  const r = await rec.get('/visitors/search?q=9876543210');
  assert.equal(r.status, 200);
  const v = r.data.items[0];
  assert.equal(v.fullName, 'Ramesh Kumar');
  assert.equal(v.companyName, 'ABC Technologies Pvt. Ltd.');
  assert.equal(v.totalVisits, 12);
  assert.equal(v.lastVisit.hostName, 'Mr. Rajesh Kumar');
  assert.equal(v.lastVisit.hostDesignation, 'Manager – Administration');
  assert.equal(v.lastVisit.purpose, 'Official Meeting');
  assert.ok(v.lastVisitAt);
});

test('search works by partial mobile, name, fuzzy name, company, email, visitor ID, pass number and QR token', async () => {
  const names = async (q) => (await rec.get(`/visitors/search?q=${encodeURIComponent(q)}`)).data.items.map((x) => x.fullName);
  assert.ok((await names('98765')).includes('Ramesh Kumar'), 'mobile prefix');
  assert.ok((await names('43210')).includes('Ramesh Kumar'), 'mobile suffix');
  assert.ok((await names('+91 98765 43210')).includes('Ramesh Kumar'), 'formatted mobile');
  assert.ok((await names('ramesh')).includes('Ramesh Kumar'), 'name');
  assert.ok((await names('Ramsh Kumr')).includes('Ramesh Kumar'), 'fuzzy (trigram) name');
  assert.ok((await names('ABC Tech')).includes('Ramesh Kumar'), 'company');
  assert.ok((await names('kumar@abc.example')).includes('Ramesh Kumar'), 'email');
  assert.ok((await names('VIS-000001')).includes('Ramesh Kumar'), 'visitor code');
  const { rows } = await query(`SELECT p.pass_number, v.qr_token FROM visitor_passes p JOIN visits v ON v.id = p.visit_id WHERE v.visitor_id = $1 LIMIT 1`, [i.ramesh]);
  assert.deepEqual(await names(rows[0].pass_number), ['Ramesh Kumar'], 'pass number');
  assert.deepEqual(await names(`http://localhost:3000/verify/${rows[0].qr_token}`), ['Ramesh Kumar'], 'scanned QR URL');
  assert.deepEqual(await names('zzzzqqqq'), []);
});

test('search results are paginated server-side and ranked', async () => {
  const r = await rec.get('/visitors/search?q=a&limit=5');
  assert.equal(r.data.items.length, 0, 'single character queries are not executed');
  const r2 = await rec.get('/visitors/search?q=kumar&limit=2');
  assert.ok(r2.data.items.length <= 2);
  assert.ok(r2.data.total >= r2.data.items.length);
});

test('SQL injection attempts are treated as plain data', async () => {
  for (const q of ["' OR 1=1 --", "'; DROP TABLE visitors; --", 'x%\' UNION SELECT password_hash FROM users --', '9876543210\' OR \'1\'=\'1']) {
    const r = await rec.get(`/visitors/search?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, q);
    assert.ok(!JSON.stringify(r.data).includes('scrypt$'), 'no password hashes leak');
  }
  const r = await rec.get(`/visits?q=${encodeURIComponent("' OR 1=1 --")}&sort=${encodeURIComponent('date; DROP TABLE visits')}`);
  assert.equal(r.status, 200);
  const { rows } = await query('SELECT count(*)::int AS n FROM visitors');
  assert.ok(rows[0].n >= 40, 'tables intact');
});

test('new visitor registration creates one visitor master and one visit', async () => {
  const mobile = newMobile();
  const r = await rec.post('/visits', visitBody(i, { visitor: { fullName: 'Anil Kapoor', mobileNumber: mobile, email: 'Anil@Example.com', designation: 'Consultant' } }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.visitorCreated, true);
  assert.equal(r.data.message, 'Visitor registration completed successfully.');
  assert.match(r.data.visit.visitor.visitorCode, /^VIS-\d{6}$/);
  assert.match(r.data.visit.visitCode, /^VST-\d{4}-\d{6}$/);
  assert.equal(r.data.visit.visitor.email, 'anil@example.com');
  assert.equal(r.data.visit.host.designation, 'Manager – Administration');
  assert.equal(r.data.visit.departmentName, 'Administration', 'department auto-populated from host');
  assert.equal(r.data.visit.companyName, 'Test Organisation Pvt Ltd', 'new company added inline');
  const { rows } = await query('SELECT count(*)::int AS n FROM visitors WHERE mobile_number = $1', [mobile]);
  assert.equal(rows[0].n, 1);
});

test('duplicate detection: an existing mobile number is reported, not duplicated', async () => {
  const dup = await rec.post('/visits', visitBody(i, { visitor: { fullName: 'Someone Else', mobileNumber: '9876543210' } }));
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error.details.type, 'DUPLICATE_VISITOR');
  assert.equal(dup.data.error.details.matches[0].fullName, 'Ramesh Kumar');
  assert.equal(dup.data.error.details.canOverride, true);
  const same = await rec.post('/visits', visitBody(i, { visitor: { fullName: 'ramesh  kumar', mobileNumber: '9876543210', duplicateOverrideReason: 'trying anyway' } }));
  assert.equal(same.status, 409, 'same person cannot be duplicated even with a reason');
  assert.equal(same.data.error.details.canOverride, false);
  const check = await rec.get('/visitors/check-duplicate?mobileCountryCode=%2B91&mobileNumber=9876543210');
  assert.equal(check.data.matches.length, 1);
});

test('a different person on a shared mobile may be registered with an audited reason', async () => {
  const r = await rec.post('/visits', visitBody(i, { visitor: { fullName: 'Suma Kumar', mobileNumber: '9876543210', duplicateOverrideReason: 'Shared family phone' } }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const { rows } = await query(`SELECT summary FROM audit_logs WHERE action = 'VISITOR_CREATED' AND summary LIKE '%Shared family phone%'`);
  assert.equal(rows.length, 1);
});

test('returning visitor: reusing the master record creates only a new visit', async () => {
  const before = (await query('SELECT count(*)::int AS n FROM visitors')).rows[0].n;
  const r = await rec.post('/visits', { visitorId: i.ramesh, visitor: {}, visit: { hostEmployeeId: i.rajesh, purposeId: i.official, categoryId: i.business, consentGiven: true }, checkIn: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.visitorCreated, false);
  assert.equal(r.data.visit.status, 'CHECKED_IN');
  assert.match(r.data.visit.pass.passNumber, /^PASS-\d{4}-\d{6}$/);
  const after = (await query('SELECT count(*)::int AS n FROM visitors')).rows[0].n;
  assert.equal(after, before, 'no new visitor master created');
  const { rows } = await query('SELECT total_visits FROM visitors WHERE id = $1', [i.ramesh]);
  assert.equal(rows[0].total_visits, 13);
  await rec.post(`/visits/${r.data.visit.id}/check-out`, {});
});

test('updating an existing visitor records only changed fields in the audit log', async () => {
  const r = await rec.put(`/visitors/${i.ramesh}`, { designation: 'Chief Operating Officer' });
  assert.equal(r.status, 200);
  assert.equal(r.data.visitor.designation, 'Chief Operating Officer');
  const { rows } = await query(`SELECT old_values, new_values FROM audit_logs WHERE action = 'VISITOR_UPDATED' AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [String(i.ramesh)]);
  assert.deepEqual(Object.keys(rows[0].new_values), ['designation']);
  assert.equal(rows[0].old_values.designation, 'General Manager');
});

test('validation: names, mobiles, emails, host and purpose', async () => {
  const bad = await rec.post('/visits', visitBody(i, { visitor: { fullName: '12345', mobileNumber: '12345', email: 'not-an-email' }, visit: { hostEmployeeId: '', purposeId: '' } }));
  assert.equal(bad.status, 422);
  const f = bad.data.error.fields;
  assert.match(f.fullName, /letters only/);
  assert.ok(f.hostEmployeeId && f.purposeId, JSON.stringify(f));
  const mobile = await rec.post('/visits', visitBody(i, { visitor: { mobileNumber: '1234567890' } }));
  assert.equal(mobile.status, 422);
  assert.match(mobile.data.error.fields.mobileNumber, /valid 10-digit Indian mobile/);
  const repeated = await rec.post('/visits', visitBody(i, { visitor: { mobileNumber: '9999999999' } }));
  assert.equal(repeated.status, 422);
  const email = await rec.post('/visits', visitBody(i, { visitor: { email: 'x@' } }));
  assert.equal(email.data.error.fields.email, 'Enter a valid email address');
  const other = await rec.post('/visits', visitBody(i, { visit: { purposeId: i.otherPurpose } }));
  assert.equal(other.status, 422);
  assert.equal(other.data.error.fields.purposeOther, 'Please specify the purpose of visit');
  const past = await rec.post('/visits', visitBody(i, { visit: { appointmentDate: '2020-01-01' } }));
  assert.equal(past.data.error.fields.appointmentDate, 'Appointment Date cannot be in the past');
  const company = await rec.post('/visits', visitBody(i, { visitor: { newCompanyName: null } }));
  assert.equal(company.data.error.fields.companyId, 'Organisation / Company is required');
});

test('stored XSS payloads are kept as inert text', async () => {
  const payload = '<img src=x onerror=alert(1)> Ltd';
  const r = await rec.post('/visits', visitBody(i, { visitor: { newCompanyName: payload } }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.visit.companyName, payload, 'stored verbatim; the UI escapes on output');
  const name = await rec.post('/visits', visitBody(i, { visitor: { fullName: '<script>alert(1)</script>' } }));
  assert.equal(name.status, 422, 'markup is not a valid person name');
});

test('restricted (blocked) visitors are denied and security is alerted', async () => {
  const r = await rec.post('/visits', { visitorId: i.sameer, visitor: {}, visit: { hostEmployeeId: i.rajesh, purposeId: i.official, categoryId: i.guest, consentGiven: true }, checkIn: true });
  assert.equal(r.status, 201);
  assert.equal(r.data.visit.status, 'DENIED');
  assert.equal(r.data.alerts[0].level, 'danger');
  const { rows } = await query(`SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id = n.recipient_user_id JOIN roles ro ON ro.id = u.role_id
                                 WHERE n.visit_id = $1 AND n.type = 'RESTRICTED_VISITOR' AND ro.code = 'SECURITY'`, [r.data.visit.id]);
  assert.ok(rows[0].n >= 1);
});

test('visitor profile returns statistics and history, and viewing is audited', async () => {
  const r = await rec.get(`/visitors/${i.ramesh}`);
  assert.equal(r.status, 200);
  assert.ok(r.data.stats.totalVisits >= 12);
  const h = await rec.get(`/visitors/${i.ramesh}/visits?pageSize=50`);
  assert.ok(h.data.items.length >= 12);
  assert.ok(h.data.items.every((v) => v.visitor.id === i.ramesh));
  const { rows } = await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'VISITOR_VIEWED' AND entity_id = $1`, [String(i.ramesh)]);
  assert.ok(rows[0].n >= 1);
});

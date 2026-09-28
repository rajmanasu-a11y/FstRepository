import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, loginAs, ids, query, visitBody, pool } from './_helpers.js';

let i;
let rec;
before(async () => { await setup(); i = await ids(); rec = await loginAs('reception'); });
after(teardown);

const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

test('pre-registration → expected → check-in (pass issued, host notified) → check-out (duration) → closed', async () => {
  const pre = await rec.post('/pre-registration', {
    visitor: { fullName: 'Kiran Rao', mobileNumber: '9812398123' },
    visit: { hostEmployeeId: i.rajesh, purposeId: i.official, appointmentDate: new Date().toISOString().slice(0, 10), expectedArrival: '23:59', expectedDurationMin: 90, specialInstructions: 'Escort to room 2' },
  });
  assert.equal(pre.status, 201, JSON.stringify(pre.data));
  const v = pre.data.visit;
  assert.equal(v.status, 'EXPECTED');
  assert.equal(v.isPreregistered, true);
  assert.ok(v.qrToken.length >= 32, 'random QR token');
  assert.ok(!v.qrToken.includes('9812398123'), 'QR token contains no personal data');
  assert.match(pre.data.message, /Visit Reference Number: VST-/);

  const lookup = await rec.get(`/visits/lookup?mode=checkin&q=${v.visitCode}`);
  assert.equal(lookup.data.items[0].id, v.id);
  const byQr = await rec.get(`/visits/lookup?mode=checkin&q=${encodeURIComponent(`http://x/verify/${v.qrToken}`)}`);
  assert.equal(byQr.data.items[0].id, v.id);

  const early = await rec.post(`/visits/${v.id}/check-in`, {});
  assert.equal(early.status, 422, 'declaration required before check-in');
  assert.equal(early.data.error.fields.consentGiven, 'The visitor declaration must be accepted before check-in');

  const ci = await rec.post(`/visits/${v.id}/check-in`, { consentGiven: true });
  assert.equal(ci.status, 200, JSON.stringify(ci.data));
  assert.equal(ci.data.message, 'Visitor successfully checked in.');
  assert.equal(ci.data.visit.status, 'CHECKED_IN');
  assert.match(ci.data.visit.pass.passNumber, /^PASS-\d{4}-\d{6}$/);
  assert.ok(new Date(ci.data.visit.validUntil) - new Date(ci.data.visit.checkInAt) === 90 * 60000);

  const notif = await query(`SELECT body FROM notifications WHERE visit_id = $1 AND type = 'VISITOR_ARRIVAL' AND channel = 'IN_APP'`, [v.id]);
  assert.equal(notif.rows.length, 1, 'host notified in-app');
  assert.match(notif.rows[0].body, /Visitor Arrival Notification[\s\S]*Visitor: Kiran Rao[\s\S]*Purpose: Official Meeting[\s\S]*Arrival: \d\d:\d\d (AM|PM)[\s\S]*Reception: Main Entrance/);

  const again = await rec.post(`/visits/${v.id}/check-in`, { consentGiven: true });
  assert.equal(again.status, 409, 'no duplicate active check-in');

  await query(`UPDATE visits SET check_in_at = now() - interval '106 minutes' WHERE id = $1`, [v.id]);
  const co = await rec.post(`/visits/${v.id}/check-out`, { remarks: 'Pass returned' });
  assert.equal(co.status, 200);
  assert.equal(co.data.message, 'Visitor check-out has been recorded successfully.');
  assert.equal(co.data.visit.status, 'CHECKED_OUT');
  assert.equal(co.data.visit.durationMinutes, 106);
  assert.ok(new Date(co.data.visit.checkOutAt) >= new Date(co.data.visit.checkInAt));
  assert.equal((await rec.post(`/visits/${v.id}/check-out`, {})).status, 409, 'cannot check out twice');

  const detail = await rec.get(`/visits/${v.id}`);
  const events = detail.data.timeline.map((t) => t.event);
  for (const e of ['PRE_REGISTERED', 'DECLARATION_ACCEPTED', 'CHECKED_IN', 'HOST_NOTIFIED', 'CHECKED_OUT', 'VISIT_CLOSED']) assert.ok(events.includes(e), e);
  assert.ok(detail.data.timeline.every((t) => t.changedAt), 'every stage is time-stamped');
  const pass = await query('SELECT status, returned_at FROM visitor_passes WHERE visit_id = $1', [v.id]);
  assert.equal(pass.rows[0].status, 'RETURNED');
});

test('check-out cannot precede check-in and a not-yet-arrived visit cannot be checked out', async () => {
  const r = await rec.post('/visits', visitBody(i));
  assert.equal(r.data.visit.status, 'APPROVED');
  const co = await rec.post(`/visits/${r.data.visit.id}/check-out`, {});
  assert.equal(co.status, 409);
  assert.match(co.data.error.message, /not checked in/);
  await assert.rejects(
    query(`UPDATE visits SET status = 'CHECKED_OUT', check_in_at = now(), check_out_at = now() - interval '1 hour' WHERE id = $1`, [r.data.visit.id]),
    /visits_checkout_after_checkin/,
  );
});

test('a future appointment is EXPECTED and cannot be checked in via registration', async () => {
  const refused = await rec.post('/visits', visitBody(i, { visit: { appointmentDate: tomorrow() }, checkIn: true }));
  assert.equal(refused.status, 422);
  assert.match(refused.data.error.fields.appointmentDate, /only possible for visits scheduled today/);
  const r = await rec.post('/visits', visitBody(i, { visit: { appointmentDate: tomorrow() } }));
  assert.equal(r.status, 201);
  assert.equal(r.data.visit.status, 'EXPECTED');
  assert.equal(r.data.visit.appointmentType, 'SCHEDULED');
});

test('restricted access area requires host approval; host approves; then check-in succeeds', async () => {
  const r = await rec.post('/visits', visitBody(i, { visit: { hostEmployeeId: i.arjun, accessAreaId: i.serverRoom }, checkIn: true }));
  assert.equal(r.status, 201);
  assert.equal(r.data.visit.status, 'PENDING_APPROVAL');
  assert.match(r.data.message, /awaiting host approval/);
  const blocked = await rec.post(`/visits/${r.data.visit.id}/check-in`, { consentGiven: true });
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error.message, /awaiting host approval/);
  const admin = await loginAs('admin');
  const ok = await admin.post(`/visits/${r.data.visit.id}/decision`, { decision: 'APPROVE', remarks: 'Escort required' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.status, 'APPROVED');
  const ci = await rec.post(`/visits/${r.data.visit.id}/check-in`, { consentGiven: true });
  assert.equal(ci.status, 200);
});

test('rejection requires a reason and denies the visit', async () => {
  const r = await rec.post('/visits', visitBody(i, { visit: { hostEmployeeId: i.arjun, accessAreaId: i.serverRoom } }));
  const admin = await loginAs('admin');
  assert.equal((await admin.post(`/visits/${r.data.visit.id}/decision`, { decision: 'REJECT' })).status, 422);
  const rej = await admin.post(`/visits/${r.data.visit.id}/decision`, { decision: 'REJECT', remarks: 'Not scheduled' });
  assert.equal(rej.data.status, 'DENIED');
});

test('categories that require ID verification block check-in until verified', async () => {
  const r = await rec.post('/visits', visitBody(i, { visit: { categoryId: i.contractor }, checkIn: true }));
  assert.equal(r.status, 422);
  assert.match(r.data.error.fields.idVerified, /Identity verification is required for Contractor/);
  const ok = await rec.post('/visits', visitBody(i, { visit: { categoryId: i.contractor, idVerified: true, verificationRemarks: 'DL sighted' }, checkIn: true }));
  assert.equal(ok.status, 201);
  assert.equal(ok.data.visit.status, 'CHECKED_IN');
  assert.equal(ok.data.visit.idVerified, true);
});

test('cancellation of an expected visit', async () => {
  const r = await rec.post('/visits', visitBody(i, { visit: { appointmentDate: tomorrow() } }));
  assert.equal((await rec.post(`/visits/${r.data.visit.id}/cancel`, { reason: 'x' })).status, 422);
  const c = await rec.post(`/visits/${r.data.visit.id}/cancel`, { reason: 'Meeting postponed' });
  assert.equal(c.data.visit.status, 'CANCELLED');
  assert.equal((await rec.post(`/visits/${r.data.visit.id}/check-in`, { consentGiven: true })).status, 409);
});

test('overstay: a checked-in visitor past the allowed duration + grace is flagged and alerts are raised', async () => {
  const r = await rec.post('/visits', visitBody(i, { visit: { expectedDurationMin: 30 }, checkIn: true }));
  const id = r.data.visit.id;
  await query(`UPDATE visits SET check_in_at = now() - interval '2 hours', valid_until = now() - interval '90 minutes' WHERE id = $1`, [id]);
  const { markOverstays } = await import('../../server/services/visits.js');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const flagged = await markOverstays(client);
    await client.query('COMMIT');
    assert.ok(flagged.some((f) => f.id === id));
  } finally { client.release(); }
  const d = await rec.get(`/visits/${id}`);
  assert.equal(d.data.visit.status, 'OVERSTAY');
  assert.ok(d.data.visit.overstayFlaggedAt);
  const n = await query(`SELECT count(*)::int AS n FROM notifications WHERE visit_id = $1 AND type = 'OVERSTAY'`, [id]);
  assert.ok(n.rows[0].n >= 1);
  const co = await rec.post(`/visits/${id}/check-out`, {});
  assert.equal(co.status, 200, 'overstaying visitors can be checked out');
  const verify = await (await loginAs('security')).get(`/verify/${r.data.visit.pass.passNumber}`);
  assert.equal(verify.data.verdict.valid, false, 'pass is invalid after check-out');
});

test('concurrency: simultaneous check-in of the same visit from two desks yields exactly one success', async () => {
  const r = await rec.post('/visits', visitBody(i));
  const desk2 = await loginAs('reception2');
  const results = await Promise.all([
    rec.post(`/visits/${r.data.visit.id}/check-in`, { consentGiven: true }),
    desk2.post(`/visits/${r.data.visit.id}/check-in`, { consentGiven: true }),
    rec.post(`/visits/${r.data.visit.id}/check-in`, { consentGiven: true }),
  ]);
  const statuses = results.map((x) => x.status).sort();
  assert.deepEqual(statuses, [200, 409, 409]);
  const passes = await query('SELECT count(*)::int AS n FROM visitor_passes WHERE visit_id = $1', [r.data.visit.id]);
  assert.equal(passes.rows[0].n, 1, 'exactly one pass issued');
});

test('concurrency: parallel registrations and check-outs from several desks do not collide', async () => {
  const desk2 = await loginAs('reception2');
  const admin = await loginAs('admin');
  const regs = await Promise.all(Array.from({ length: 12 }, (_, k) => [rec, desk2, admin][k % 3].post('/visits', visitBody(i, { checkIn: true }))));
  assert.ok(regs.every((x) => x.status === 201), JSON.stringify(regs.map((x) => x.status)));
  const codes = regs.map((x) => x.data.visit.visitCode);
  const passes = regs.map((x) => x.data.visit.pass.passNumber);
  assert.equal(new Set(codes).size, codes.length, 'unique visit reference numbers');
  assert.equal(new Set(passes).size, passes.length, 'unique pass numbers');
  const outs = await Promise.all(regs.map((x, k) => [rec, desk2][k % 2].post(`/visits/${x.data.visit.id}/check-out`, {})));
  assert.ok(outs.every((x) => x.status === 200));
});

test('the same visitor cannot be checked in under two visits at once', async () => {
  const first = await rec.post('/visits', visitBody(i, { checkIn: true }));
  const visitorId = first.data.visit.visitor.id;
  const second = await rec.post('/visits', { visitorId, visitor: {}, visit: { hostEmployeeId: i.priya, purposeId: i.official, categoryId: i.guest, consentGiven: true }, checkIn: true });
  assert.equal(second.status, 409);
  assert.match(second.data.error.message, /already checked in/);
});

test('on-premises list and emergency roll call include checked-in visitors grouped by category', async () => {
  const cur = await rec.get('/visits/current');
  assert.ok(cur.data.items.length > 0);
  assert.ok(cur.data.items.every((v) => ['CHECKED_IN', 'OVERSTAY'].includes(v.status)));
  const em = await rec.get('/reports/emergency');
  assert.deepEqual(em.data.groups.map((g) => g.title), ['Employees (Visiting Staff)', 'Visitors', 'Contractors', 'Service Personnel']);
  assert.equal(em.data.total, cur.data.items.length);
});

test('visit reference, pass number and QR token lookups resolve the same visit', async () => {
  const r = await rec.post('/visits', visitBody(i, { checkIn: true }));
  const v = r.data.visit;
  for (const key of [v.id, v.visitCode, v.pass.passNumber, v.qrToken]) {
    const d = await rec.get(`/visits/${encodeURIComponent(key)}`);
    assert.equal(d.data.visit.id, v.id, String(key));
  }
  const qr = await rec.get(`/visits/${v.id}/qr.svg`);
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
});

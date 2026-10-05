import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../core/api.js';

const MIN = 60e3;
function setup() {
  const api = createApi({});
  const call = (method, path, token, body, query) => {
    const r = api.handle(method, path, { token, body, query });
    if (r.status >= 400) { const e = new Error(r.data.error); e.status = r.status; throw e; }
    return r.data;
  };
  // sign in any seeded user directly (the demo login only lists the eight personas)
  const as = (userId) => api.db.insert('sessions', { token: 'test_' + userId + Math.random(), userId }, 'ses').token;
  const advance = (minutes) => call('POST', '/demo/advance', null, { minutes });
  return { api, call, as, advance, db: api.db };
}

test('visit lifecycle: GPS and code check-in, checklist checkout, family confirm, escrow release and payout', () => {
  const { call, as, advance, db } = setup();
  const priya = as('usr_priya'), arjun = as('usr_arjun');
  const today = call('GET', '/caregiver/home', priya).today.find((b) => b.seniorId === 'sen_kamala' && b.status === 'assigned');
  assert.ok(today, 'Priya has an assigned visit today');
  const senior = db.get('seniors', 'sen_kamala');
  advance(Math.max(0, Math.ceil((today.start - db.now()) / MIN) - 5));
  assert.throws(() => call('POST', `/bookings/${today.id}/checkin`, priya, { lat: senior.lat + 0.004, lng: senior.lng, code: today.visitCode || '4821' }), /m from the senior/);
  assert.throws(() => call('POST', `/bookings/${today.id}/checkin`, priya, { lat: senior.lat, lng: senior.lng, code: '0000' }), /visit code/);
  const b = db.get('bookings', today.id);
  call('POST', `/bookings/${b.id}/checkin`, priya, { lat: senior.lat, lng: senior.lng, code: b.visitCode });
  assert.equal(db.get('bookings', b.id).status, 'in_progress');
  assert.throws(() => call('POST', `/bookings/${b.id}/checkout`, priya, { checklist: {} }), /checklist/);
  const items = call('GET', `/bookings/${b.id}`, priya).checklistItems;
  call('POST', `/bookings/${b.id}/checkout`, priya, { checklist: Object.fromEntries(items.map((i) => [i, true])), vitals: { bpSys: 132, bpDia: 82, sugar: 130 } });
  assert.equal(db.get('bookings', b.id).status, 'completed');
  call('POST', `/bookings/${b.id}/confirm`, arjun);
  assert.equal(db.get('bookings', b.id).status, 'confirmed');
  const po = db.find('payouts', (p) => p.bookingId === b.id);
  assert.equal(po.status, 'scheduled');
  assert.equal(db.filter('invoices', (i) => i.bookingId === b.id).length, 2, 'provider and platform invoices');
  advance(3 * 24 * 60);
  assert.equal(db.get('payouts', po.id).status, 'paid');
});

test('reviews: only geo-verified visits, senior and payer each once, weighted 60/40', () => {
  const { call, as, db } = setup();
  const arjun = as('usr_arjun'), kamala = as('usr_kamala');
  const done = db.find('bookings', (b) => b.seniorId === 'sen_kamala' && b.status === 'completed' && b.checkInAt);
  call('POST', `/bookings/${done.id}/review`, kamala, { ratings: { punctuality: 5, skill: 5, behaviour: 5, hygiene: 5, communication: 5 }, text: 'Priya was gentle and explained the dressing.' });
  call('POST', `/bookings/${done.id}/review`, arjun, { ratings: { punctuality: 3, skill: 3, behaviour: 3, hygiene: 3, communication: 3 }, text: 'Came a little late but did the job.' });
  assert.throws(() => call('POST', `/bookings/${done.id}/review`, arjun, { overall: 5 }), /already reviewed/);
  assert.equal(call('GET', `/bookings/${done.id}`, arjun).rating, 4.2);
});

test('approval rule: a manager booking above the limit waits for the owner', () => {
  const { call, as, db } = setup();
  const meera = as('usr_meera'), arjun = as('usr_arjun');
  call('PUT', '/seniors/sen_kamala/approval-rule', arjun, { enabled: true, threshold: 500 });
  const listing = db.find('listings', (l) => l.serviceId === 'svc_nurse_visit' && l.status === 'published' && l.providerId === 'prv_lakeside');
  const days = call('GET', `/listings/${listing.id}/slots`, meera, null, { days: 7 });
  const slot = days.flatMap((d) => d.slots).find((s) => s.free);
  const b = call('POST', '/bookings', meera, { listingId: listing.id, seniorId: 'sen_kamala', start: slot.start });
  assert.equal(b.status, 'pending_approval');
  const ok = call('POST', `/bookings/${b.id}/approve`, arjun, {});
  assert.equal(ok.status, 'requested');
});

test('catalogue rules: a helper cannot list a nursing service', () => {
  const { call, as } = setup();
  const ravi = as('usr_ravi');
  assert.throws(() => call('POST', '/my/listings', ravi, { serviceId: 'svc_nurse_visit', minCharge: 600 }), /cannot|not allowed|qualif/i);
});

test('SOS: alerts circle, contacts and desk; escalates if not acknowledged in 45 s', () => {
  const { call, as, advance, db } = setup();
  const kamala = as('usr_kamala'), imran = as('usr_imran');
  const c = call('POST', '/sos', kamala, {});
  assert.equal(c.status, 'open');
  const sms = db.filter('notifications', (n) => n.event === 'sos' && n.channel === 'sms');
  assert.ok(sms.length >= 3, 'family and emergency contacts get SMS');
  advance(1);
  assert.ok(db.get('cases', c.id).timeline.some((x) => /supervisor/i.test(x.text)), 'escalated to supervisor');
  call('POST', `/cases/${c.id}/ack`, imran);
  call('POST', `/cases/${c.id}/action`, imran, { kind: 'dispatch_ambulance', eta: 12 });
  call('POST', `/cases/${c.id}/close`, imran, { outcome: 'Treated at home' });
  assert.equal(db.get('cases', c.id).status, 'closed');
});

test('medicines: a dose not taken is reminded, then marked missed and the family told', () => {
  const { as, advance, db, call } = setup();
  call('GET', '/me', as('usr_kamala'));
  const now = db.now();
  const next = db.filter('doses', (d) => d.seniorId === 'sen_kamala' && d.due > now && d.status === 'due').sort((a, b) => a.due - b.due)[0];
  assert.ok(next);
  advance(Math.ceil((next.due - now) / MIN) + 65);
  assert.equal(db.get('doses', next.id).status, 'missed');
  assert.ok(db.filter('notifications', (n) => n.userId === 'usr_arjun' && /dose/i.test(n.title)).length);
});

test('subscription: failed renewal gives a 7-day grace period, then lapses', () => {
  const { call, as, advance, db } = setup();
  const arjun = as('usr_arjun');
  call('POST', '/subscriptions/sub_kamala/simulate-failure', arjun);
  advance(5);
  assert.equal(db.get('subscriptions', 'sub_kamala').status, 'grace');
  advance(8 * 24 * 60);
  assert.equal(db.get('subscriptions', 'sub_kamala').status, 'lapsed');
});

test('consent ledger records withdrawal', () => {
  const { call, as } = setup();
  const arjun = as('usr_arjun');
  call('POST', '/me/consents', arjun, { purpose: 'marketing', granted: true });
  call('POST', '/me/consents', arjun, { purpose: 'marketing', granted: false });
  const c = call('GET', '/me/consents', arjun);
  assert.equal(c.current.find((x) => x.id === 'marketing').granted, false);
  assert.ok(c.ledger.length >= 5);
});

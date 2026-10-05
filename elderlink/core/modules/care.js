// FR-SUB (family subscription), FR-CHK (monthly check visits), FR-MED (medicine tracking).
import { assert, istDateKey, istTime, addDaysKey, weekdayOfKey, DAY, MIN } from '../util.js';
import { activity, audit, notify, notifyCircle, notifyStaff, requireSenior, serviceById, requireRole } from '../context.js';
import { adherence, proRata } from '../rules.js';
import { capture, refund } from '../payments.js';

const PERIOD = 30 * DAY;

export function planFor(db, sub) { return db.get('plans', sub.planId); }

function subView(db, s) {
  const plan = planFor(db, s);
  const cc = s.coordinatorId ? db.get('users', s.coordinatorId) : null;
  const pendingPlan = s.pendingPlanId ? db.get('plans', s.pendingPlanId) : null;
  return { ...s, plan, coordinator: cc ? { id: cc.id, name: cc.name, mobile: cc.mobile } : null, pendingPlan };
}

/** FR-CHK-01: propose check-visit dates on the preferred weekday for the next period. */
export function scheduleCheckVisits(db, sub, fromTs) {
  const plan = planFor(db, sub);
  const senior = db.get('seniors', sub.seniorId);
  const pref = sub.checkDay || { weekday: 6, time: '10:00' };
  const count = plan.checkVisits;
  const gap = Math.floor(28 / count);
  let key = istDateKey(fromTs + DAY);
  while (weekdayOfKey(key) !== pref.weekday) key = addDaysKey(key, 1);
  const svc = serviceById(db, 'svc_check');
  for (let i = 0; i < count; i++) {
    const start = istTime(addDaysKey(key, i * gap), pref.time);
    if (db.find('bookings', (b) => b.seniorId === sub.seniorId && b.isCheckVisit && Math.abs(b.start - start) < DAY && b.status !== 'cancelled')) continue;
    // FR-CHK-02: prefer the same nurse as last time
    const last = db.filter('bookings', (b) => b.seniorId === sub.seniorId && b.isCheckVisit && b.caregiverId).sort((a, b) => b.start - a.start)[0];
    const cg = last ? db.get('caregivers', last.caregiverId) : null;
    db.insert('bookings', {
      seniorId: sub.seniorId, seniorName: senior.name, listingId: null, serviceId: svc.id, serviceName: svc.name, serviceNameHi: svc.nameHi, checklistKey: 'check',
      providerId: cg?.providerId || null, providerName: cg ? db.get('providers', cg.providerId).name : 'ElderLink care team', caregiverId: null, caregiverName: null,
      start, end: start + 60 * MIN, qty: 1, addOns: [], notes: 'Included in subscription', price: { serviceValue: 0, addOnsValue: 0, discount: 0, careValue: 0, platformFee: 0, gst: 0, total: 0, commission: 0, providerShare: svc.medianPrice, elderlinkFee: 0 },
      status: 'accepted', bookedBy: 'system', source: 'subscription', subscriptionId: sub.id, visitCode: String(1000 + Math.floor(Math.random() * 9000)), isCheckVisit: true,
      timeline: [{ at: db.now(), text: 'Scheduled as part of the subscription' }], alerts: {}, checkInAttempts: 0, preferredCaregiverId: cg?.id || null,
    }, 'bkg');
  }
}

function activate(db, user, senior, plan, { cycle, method }) {
  const now = db.now();
  const amount = cycle === 'annual' ? plan.price * 10 : plan.price; // annual prepay: two months free
  const pay = capture(db, { userId: user.id, seniorId: senior.id, amount, purpose: `${plan.name} plan (${cycle})`, method });
  const cc = plan.coordinator ? db.find('users', (u) => u.role === 'coordinator') : null;
  const sub = db.insert('subscriptions', {
    seniorId: senior.id, planId: plan.id, payerId: user.id, cycle, method, mandateId: method === 'upi_autopay' || method === 'card_mandate' ? 'mdt_' + Math.random().toString(36).slice(2, 10) : null,
    status: 'active', periodStart: now, periodEnd: now + (cycle === 'annual' ? 12 : 1) * PERIOD, nextBillingAt: now + (cycle === 'annual' ? 12 : 1) * PERIOD,
    coordinatorId: cc?.id || null, checkDay: { weekday: 6, time: '10:00' }, failCount: 0, payments: [pay.id],
  }, 'sub');
  pay.subscriptionId = sub.id;
  db.insert('invoices', { subscriptionId: sub.id, seniorId: senior.id, number: `ELK/SUB/${String(db.all('invoices').length + 1).padStart(5, '0')}`, issuer: 'ElderLink Care Technologies Pvt Ltd (demo)', issuerGstin: '29AAAAA0000A1Z5', kind: 'subscription', lines: [{ text: `${plan.name} plan, ${cycle}`, amount: Math.round(amount / 1.18) }], taxable: Math.round(amount / 1.18), gst: amount - Math.round(amount / 1.18), total: amount, note: 'Price includes GST at 18%.' }, 'inv');
  scheduleCheckVisits(db, sub, now);
  if (!senior.checkinSettings?.enabled) db.update('seniors', senior.id, { checkinSettings: { enabled: true, time: '09:00', human: false } });
  return sub;
}

export function routes(r) {
  r('GET', '/plans', ({ db }) => db.all('plans').filter((p) => p.active !== false), { public: true });

  r('GET', '/seniors/:id/subscription', ({ db, user, params }) => {
    requireSenior(db, user, params.id);
    const s = db.filter('subscriptions', (x) => x.seniorId === params.id).sort((a, b) => b.createdAt - a.createdAt)[0];
    const checkVisits = db.filter('bookings', (b) => b.seniorId === params.id && b.isCheckVisit).sort((a, b) => a.start - b.start);
    return { subscription: s ? subView(db, s) : null, checkVisits: checkVisits.slice(-8) };
  });

  // FR-SUB-02
  r('POST', '/seniors/:id/subscription', ({ db, user, params, body }) => {
    const { senior } = requireSenior(db, user, params.id, 'manage');
    const existing = db.find('subscriptions', (x) => x.seniorId === senior.id && ['active', 'grace'].includes(x.status));
    assert(!existing, 400, 'This senior already has a plan. Use change plan instead.');
    const plan = db.get('plans', body.planId);
    assert(plan, 400, 'Choose a plan');
    const sub = activate(db, user, senior, plan, { cycle: body.cycle === 'annual' ? 'annual' : 'monthly', method: body.method || 'upi_autopay' });
    notifyCircle(db, senior.id, { channels: ['push', 'whatsapp'], title: 'Plan active', body: `${senior.name} is now on the ${plan.name} plan. SOS, medicine tracking and check visits are on.`, event: 'subscription' }, { includeSenior: true });
    activity(db, senior.id, user, `subscribed to ${plan.name} (${sub.cycle})`, 'subscription');
    audit(db, user, 'subscription.create', sub.id);
    return subView(db, sub);
  });

  // FR-SUB-03 upgrade now with pro-rata, downgrade at renewal
  r('POST', '/subscriptions/:id/change', ({ db, user, params, body }) => {
    const sub = db.get('subscriptions', params.id);
    assert(sub, 404, 'Not found');
    requireSenior(db, user, sub.seniorId, 'manage');
    const oldPlan = planFor(db, sub);
    const plan = db.get('plans', body.planId);
    assert(plan && plan.id !== oldPlan.id, 400, 'Choose a different plan');
    if (plan.price > oldPlan.price) {
      const charge = proRata({ oldPrice: oldPlan.price, newPrice: plan.price, periodStart: sub.periodStart, periodEnd: sub.periodEnd, now: db.now() });
      const pay = capture(db, { userId: user.id, seniorId: sub.seniorId, amount: charge, purpose: `Upgrade to ${plan.name} (pro-rata)`, method: sub.method });
      sub.payments.push(pay.id);
      sub.planId = plan.id;
      sub.pendingPlanId = null;
      if (plan.coordinator && !sub.coordinatorId) sub.coordinatorId = db.find('users', (u) => u.role === 'coordinator')?.id;
      scheduleCheckVisits(db, sub, db.now());
      activity(db, sub.seniorId, user, `upgraded to ${plan.name} (Rs ${charge} pro-rata)`, 'subscription');
      db.dirty = true;
      return { ...subView(db, sub), message: `Upgraded now. Rs ${charge} charged for the rest of this period.` };
    }
    sub.pendingPlanId = plan.id;
    activity(db, sub.seniorId, user, `scheduled a change to ${plan.name} from next renewal`, 'subscription');
    db.dirty = true;
    return { ...subView(db, sub), message: `Your plan changes to ${plan.name} at the next renewal.` };
  });

  // FR-SUB-05
  r('POST', '/subscriptions/:id/cancel', ({ db, user, params }) => {
    const sub = db.get('subscriptions', params.id);
    assert(sub, 404, 'Not found');
    requireSenior(db, user, sub.seniorId, 'manage');
    let refunded = 0;
    if (sub.cycle === 'annual') {
      const monthsLeft = Math.floor((sub.periodEnd - db.now()) / PERIOD);
      const pay = db.get('payments', sub.payments[0]);
      refunded = Math.min(pay.amount, monthsLeft * Math.round(pay.amount / 12));
      if (refunded > 0) refund(db, { payment: pay, amount: refunded, reason: 'Unused full months of annual plan' });
    }
    sub.status = 'cancelling';
    sub.cancelAt = sub.cycle === 'annual' ? db.now() : sub.periodEnd;
    activity(db, sub.seniorId, user, 'cancelled the plan', 'subscription');
    db.dirty = true;
    return { ...subView(db, sub), message: sub.cycle === 'annual' ? `Cancelled. Rs ${refunded} for unused months is being refunded.` : `Cancelled. Benefits continue until ${new Date(sub.periodEnd).toLocaleDateString('en-IN')}.` };
  });

  r('POST', '/subscriptions/:id/checkday', ({ db, user, params, body }) => {
    const sub = db.get('subscriptions', params.id);
    assert(sub, 404, 'Not found');
    requireSenior(db, user, sub.seniorId, 'manage');
    sub.checkDay = { weekday: Number(body.weekday), time: body.time || '10:00' };
    // move future unassigned check visits to the new day
    for (const b of db.filter('bookings', (x) => x.subscriptionId === sub.id && x.isCheckVisit && x.start > db.now() && ['accepted', 'assigned'].includes(x.status))) b.status = 'cancelled';
    scheduleCheckVisits(db, sub, db.now());
    db.dirty = true;
    return subView(db, sub);
  });

  // FR-SUB-04: pay now during the grace period
  r('POST', '/subscriptions/:id/pay-now', ({ db, user, params, body }) => {
    const sub = db.get('subscriptions', params.id);
    assert(sub, 404, 'Not found');
    requireSenior(db, user, sub.seniorId, 'manage');
    assert(['grace', 'lapsed'].includes(sub.status), 400, 'Nothing is due');
    const plan = planFor(db, sub);
    const pay = capture(db, { userId: user.id, seniorId: sub.seniorId, amount: plan.price, purpose: `${plan.name} plan renewal`, method: body.method || 'upi' });
    sub.payments.push(pay.id);
    Object.assign(sub, { status: 'active', failNext: false, failCount: 0, graceUntil: null, nextRetryAt: null, periodStart: db.now(), periodEnd: db.now() + PERIOD, nextBillingAt: db.now() + PERIOD, method: body.method || sub.method });
    scheduleCheckVisits(db, sub, db.now());
    activity(db, sub.seniorId, user, `paid the ${plan.name} renewal`, 'subscription');
    db.dirty = true;
    return subView(db, sub);
  });

  r('POST', '/subscriptions/:id/simulate-failure', ({ db, user, params }) => {
    const sub = db.get('subscriptions', params.id);
    requireSenior(db, user, sub.seniorId, 'manage');
    sub.failNext = true;
    sub.nextBillingAt = db.now() + 60 * 1000;
    db.dirty = true;
    return { ok: true, message: 'The next renewal will fail. Use the demo clock to watch retries on days 1, 3 and 5 and the 7-day SOS grace period.' };
  });

  // FR-CHK-06 extra check visit at subscriber rate
  r('POST', '/seniors/:id/extra-check', ({ db, user, params, body }) => {
    const { senior } = requireSenior(db, user, params.id, 'manage');
    const sub = db.find('subscriptions', (x) => x.seniorId === senior.id && x.status === 'active');
    assert(sub, 400, 'Extra check visits are for subscribers. Book a wellness check visit from Find care instead.');
    const svc = serviceById(db, 'svc_check');
    const price = Math.round(svc.medianPrice * 0.8);
    const start = Number(body.start) || db.now() + 2 * DAY;
    const pay = capture(db, { userId: user.id, seniorId: senior.id, amount: price, purpose: 'Extra check visit', method: body.method || 'upi' });
    const b = db.insert('bookings', {
      seniorId: senior.id, seniorName: senior.name, serviceId: svc.id, serviceName: svc.name, serviceNameHi: svc.nameHi, checklistKey: 'check', providerId: null, providerName: 'ElderLink care team',
      start, end: start + 60 * MIN, qty: 1, addOns: [], notes: 'Extra check visit', price: { serviceValue: price, addOnsValue: 0, discount: 0, careValue: price, platformFee: 0, gst: 0, total: price, commission: Math.round(price * 0.15), providerShare: price - Math.round(price * 0.15), elderlinkFee: Math.round(price * 0.15) },
      status: 'accepted', bookedBy: user.id, payerId: user.id, paymentId: pay.id, source: 'subscription', subscriptionId: sub.id, visitCode: String(1000 + Math.floor(Math.random() * 9000)), isCheckVisit: true, timeline: [{ at: db.now(), text: `Extra check visit requested by ${user.name}` }], alerts: {}, checkInAttempts: 0,
    }, 'bkg');
    pay.bookingId = b.id; pay.status = 'escrow';
    notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Assign a nurse', body: `Extra check visit for ${senior.name}`, event: 'check_visit' });
    activity(db, senior.id, user, 'requested an extra check visit');
    return b;
  });

  // ---- medicines ----
  r('GET', '/seniors/:id/medicines', ({ db, user, params }) => {
    requireSenior(db, user, params.id);
    const meds = db.filter('medicines', (m) => m.seniorId === params.id && m.active);
    const since = db.now() - 7 * DAY;
    return meds.map((m) => {
      const doses = db.filter('doses', (d) => d.medicineId === m.id && d.due >= since && d.due <= db.now());
      const perDay = m.times.length * (m.doseQty || 1);
      return { ...m, adherence7: adherence(doses), daysLeft: perDay ? Math.floor((m.stock || 0) / perDay) : null };
    });
  });

  // FR-MED-01 OCR is mocked: returns typical lines from the sample prescription for the user to confirm.
  r('POST', '/seniors/:id/medicines/scan', ({ db, user, params }) => {
    requireSenior(db, user, params.id, 'manage');
    return { extracted: [
      { name: 'Telma 40 (Telmisartan)', generic: 'Telmisartan', strength: '40 mg', form: 'tablet', dose: '1 tablet', times: ['08:00'], food: 'after food', confidence: 0.93 },
      { name: 'Ecosprin 75 (Aspirin)', generic: 'Aspirin', strength: '75 mg', form: 'tablet', dose: '1 tablet', times: ['14:00'], food: 'after food', confidence: 0.88, critical: true },
    ], note: 'Please check each line against the prescription before saving. ElderLink never changes or suggests medicines.' };
  });

  r('POST', '/seniors/:id/medicines', ({ db, user, params, body }) => {
    requireSenior(db, user, params.id, 'manage');
    assert(body.name && body.times?.length, 400, 'Medicine name and at least one time are needed');
    for (const t of body.times) assert(/^\d\d:\d\d$/.test(t), 400, 'Times must look like 08:00');
    const dup = db.find('medicines', (m) => m.seniorId === params.id && m.active && body.generic && m.generic?.toLowerCase() === body.generic.toLowerCase());
    const m = db.insert('medicines', {
      seniorId: params.id, name: body.name, generic: body.generic || '', strength: body.strength || '', form: body.form || 'tablet', dose: body.dose || '1 tablet', doseQty: Number(body.doseQty) || 1,
      times: body.times.sort(), food: body.food || '', startDate: body.startDate || istDateKey(db.now()), endDate: body.endDate || null, doctor: body.doctor || '',
      stock: Number(body.stock) || 30, critical: !!body.critical, color: body.color || '#f2f2f2', shape: body.shape || 'round', active: true, addedBy: user.name,
    }, 'med');
    activity(db, params.id, user, `added medicine ${m.name}`);
    return { medicine: m, warning: dup ? `${dup.name} has the same generic (${dup.generic}). Please check with the doctor before giving both.` : null };
  });
  r('PATCH', '/medicines/:id', ({ db, user, params, body }) => {
    const m = db.get('medicines', params.id);
    assert(m, 404, 'Not found');
    requireSenior(db, user, m.seniorId, 'manage');
    const patch = {};
    for (const k of ['stock', 'times', 'dose', 'critical', 'active', 'endDate', 'food']) if (body[k] !== undefined) patch[k] = body[k];
    db.update('medicines', m.id, patch);
    if (patch.active === false) {
      for (const d of db.filter('doses', (x) => x.medicineId === m.id && x.due > db.now() && x.status === 'due')) db.remove('doses', d.id);
      activity(db, m.seniorId, user, `stopped ${m.name}`);
    }
    return db.get('medicines', m.id);
  });

  r('GET', '/seniors/:id/doses', ({ db, user, params, query }) => {
    requireSenior(db, user, params.id);
    const key = query.date || istDateKey(db.now());
    const from = istTime(key, '00:00');
    return db.filter('doses', (d) => d.seniorId === params.id && d.due >= from && d.due < from + DAY).sort((a, b) => a.due - b.due)
      .map((d) => ({ ...d, medicine: db.get('medicines', d.medicineId) }));
  });

  // FR-MED-04: Taken / Skip / Later
  r('POST', '/doses/:id', ({ db, user, params, body }) => {
    const d = db.get('doses', params.id);
    assert(d, 404, 'Not found');
    requireSenior(db, user, d.seniorId);
    const status = body.status;
    assert(['taken', 'skipped', 'later'].includes(status), 400, 'Choose Taken, Skip or Later');
    if (status === 'later') { d.status = 'later'; d.snoozeUntil = db.now() + 15 * MIN; }
    else {
      d.status = status; d.takenAt = db.now(); d.source = user.role === 'senior' ? 'senior app' : `marked by ${user.name}`;
      const m = db.get('medicines', d.medicineId);
      if (status === 'taken' && m) m.stock = Math.max(0, (m.stock || 0) - (m.doseQty || 1));
      if (status === 'skipped') notifyCircle(db, d.seniorId, { channels: ['push'], title: 'Dose skipped', body: `${d.seniorName} skipped ${d.medName} (${d.time}).`, event: 'missed_dose' });
    }
    db.dirty = true;
    return d;
  });

  r('GET', '/seniors/:id/adherence', ({ db, user, params, query }) => {
    requireSenior(db, user, params.id);
    const days = Number(query.days) || 30;
    const out = [];
    let key = istDateKey(db.now() - (days - 1) * DAY);
    for (let i = 0; i < days; i++) {
      const from = istTime(key, '00:00');
      const doses = db.filter('doses', (d) => d.seniorId === params.id && d.due >= from && d.due < from + DAY && d.due <= db.now());
      out.push({ date: key, pct: adherence(doses), taken: doses.filter((d) => d.status === 'taken').length, missed: doses.filter((d) => d.status === 'missed').length, total: doses.length });
      key = addDaysKey(key, 1);
    }
    const all = db.filter('doses', (d) => d.seniorId === params.id && d.due >= db.now() - days * DAY && d.due <= db.now());
    const meds = db.filter('medicines', (m) => m.seniorId === params.id && m.active).map((m) => ({ id: m.id, name: m.name, pct: adherence(all.filter((d) => d.medicineId === m.id)) }));
    return { days: out, overall: adherence(all), meds };
  });

  // FR-MED-11 printable chart
  r('GET', '/seniors/:id/medchart', ({ db, user, params }) => {
    const { senior } = requireSenior(db, user, params.id);
    const meds = db.filter('medicines', (m) => m.seniorId === senior.id && m.active);
    const slots = [...new Set(meds.flatMap((m) => m.times))].sort();
    return { senior: { name: senior.name, language: senior.languages?.[0] }, slots, meds };
  });

  // FR-SUB-08 monthly care summary
  r('GET', '/seniors/:id/summary', ({ db, user, params }) => {
    const { senior } = requireSenior(db, user, params.id);
    const since = db.now() - 30 * DAY;
    const visits = db.filter('bookings', (b) => b.seniorId === senior.id && b.start >= since && b.start <= db.now());
    const doses = db.filter('doses', (d) => d.seniorId === senior.id && d.due >= since && d.due <= db.now());
    const vit = db.filter('vitals', (v) => v.seniorId === senior.id && v.at >= since).sort((a, b) => a.at - b.at);
    const cases = db.filter('cases', (c) => c.seniorId === senior.id && c.createdAt >= since);
    const spend = db.filter('payments', (p) => p.seniorId === senior.id && p.createdAt >= since).reduce((s, p) => s + p.amount - (p.refunded || 0), 0);
    return {
      senior: { name: senior.name, age: Math.floor((db.now() - Date.parse(senior.dob)) / (365.25 * DAY)) }, from: since, to: db.now(),
      visitsDone: visits.filter((b) => ['completed', 'confirmed', 'paid_out'].includes(b.status)).length, visitsMissed: visits.filter((b) => b.status === 'no_show').length,
      adherence: adherence(doses), missedDoses: doses.filter((d) => d.status === 'missed').length, vitals: vit, sos: cases.length, spend,
    };
  });

  r('POST', '/ops/checkvisits/:id/assign', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const b = db.get('bookings', params.id);
    assert(b && b.isCheckVisit, 404, 'Check visit not found');
    const cg = db.get('caregivers', body.caregiverId);
    assert(cg && cg.status === 'verified' && ['RN', 'GNM', 'ANM'].includes(cg.category), 400, 'Assign a verified nurse (GNM / ANM or above)');
    b.providerId = cg.providerId;
    b.providerName = db.get('providers', cg.providerId).name;
    b.caregiverId = cg.id; b.caregiverName = cg.name; b.status = 'assigned'; b.assignedAt = db.now();
    (b.timeline ||= []).push({ at: db.now(), text: `${cg.name} assigned by coordinator ${user.name}` });
    notifyCircle(db, b.seniorId, { channels: ['push'], title: 'Check visit nurse assigned', body: `${cg.name} will do ${b.seniorName}'s check visit on ${new Date(b.start).toLocaleDateString('en-IN')}.`, event: 'caregiver_assigned' }, { includeSenior: true });
    if (cg.userId) notify(db, { to: cg.userId, channels: ['push'], title: 'Check visit assigned', body: `${b.seniorName}, ${new Date(b.start).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`, event: 'assigned' });
    db.dirty = true;
    return b;
  });

}

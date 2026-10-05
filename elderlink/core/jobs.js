// Scheduled rules. In production these run as cron workers; here they run before each request
// (and on demand from the demo clock), are idempotent, and only act on what is due.
import { istDateKey, istTime, addDaysKey, DAY, HOUR, MIN } from './util.js';
import { config, notify, notifyCircle, notifyStaff } from './context.js';
import { capture, refund } from './payments.js';
import { confirmBooking } from './modules/bookings.js';
import { setCaregiverStatus } from './modules/ops.js';
import { scheduleCheckVisits } from './modules/care.js';

const RECENT = 6 * HOUR; // events older than this are settled quietly (no notification flood after time jumps)

export function ensureDoses(db) {
  const today = istDateKey(db.now());
  for (const m of db.filter('medicines', (x) => x.active)) {
    const s = db.get('seniors', m.seniorId);
    for (const key of [today, addDaysKey(today, 1)]) {
      if (m.startDate && key < m.startDate) continue;
      if (m.endDate && key > m.endDate) continue;
      for (const time of m.times) {
        const due = istTime(key, time);
        if (db.find('doses', (d) => d.medicineId === m.id && d.due === due)) continue;
        db.insert('doses', { medicineId: m.id, seniorId: m.seniorId, seniorName: s?.name, medName: `${m.name} ${m.strength}`.trim(), time, due, status: 'due', critical: !!m.critical }, 'dos');
      }
    }
  }
}

export function runPayouts(db) {
  let n = 0;
  for (const p of db.filter('payouts', (x) => x.status === 'scheduled' && x.dueAt <= db.now())) {
    const b = db.get('bookings', p.bookingId);
    if (b?.status === 'disputed') { p.status = 'held'; continue; }
    p.status = 'paid';
    p.paidAt = db.now();
    p.utr = 'UTR' + Math.floor(Math.random() * 1e10);
    if (b && b.status === 'confirmed') { b.status = 'paid_out'; (b.timeline ||= []).push({ at: db.now(), text: `Rs ${p.amount} paid to provider (UTR ${p.utr})` }); }
    const prov = db.get('providers', p.providerId);
    if (prov?.adminUserId) notify(db, { to: prov.adminUserId, channels: ['push'], title: 'Payout sent', body: `Rs ${p.amount} sent to your bank for ${b?.serviceName || 'a visit'}.`, event: 'payout' });
    n++;
  }
  db.dirty = true;
  return n;
}

export function runJobs(db, { force = false } = {}) {
  const now = db.now();
  const meta = db.data.meta;
  if (!force && meta.lastJobs && now - meta.lastJobs < 15 * 1000 && now >= meta.lastJobs) return [];
  meta.lastJobs = now;
  const events = [];
  const c = config(db);
  ensureDoses(db);

  // FR-MED-04..06 dose reminders, repeat, missed, critical escalation
  for (const d of db.filter('doses', (x) => ['due', 'reminded', 'later'].includes(x.status) && x.due <= now)) {
    const recent = now - d.due < RECENT;
    const senior = db.get('seniors', d.seniorId);
    if (d.status === 'later' && d.snoozeUntil > now) continue;
    if (now - d.due >= c.doseMissedMin * MIN) {
      d.status = 'missed';
      if (recent) {
        notifyCircle(db, d.seniorId, { channels: d.critical ? ['push', 'sms', 'voice'] : ['push'], title: d.critical ? 'Critical dose missed' : 'Dose missed', body: `${d.seniorName} has not confirmed ${d.medName} due at ${d.time}.${d.critical ? ' Please call now.' : ''}`, event: 'missed_dose', critical: d.critical });
        if (d.critical) notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Critical dose missed', body: `${d.seniorName}: ${d.medName}`, event: 'missed_dose' });
        events.push(`Dose missed: ${d.seniorName} ${d.medName} ${d.time}`);
      }
    } else if (!d.reminded) {
      d.reminded = now; d.status = 'reminded';
      if (recent && senior?.userId) notify(db, { to: senior.userId, channels: ['push', 'voice'], title: 'Medicine time', body: `Time for ${d.medName}. Press Taken after you take it.`, event: 'dose_reminder' });
      if (recent && !senior?.userId && senior?.mobile) notify(db, { toName: senior.name, toPhone: senior.mobile, channels: ['voice'], title: 'Medicine time (IVR)', body: `Time for ${d.medName}. Press 1 if taken, 2 to skip.`, event: 'dose_reminder', seniorId: senior.id });
      if (recent) events.push(`Reminder: ${d.seniorName} ${d.medName}`);
    } else if (!d.repeated && now - d.due >= c.doseRepeatMin * MIN) {
      d.repeated = now;
      if (recent && senior?.userId) notify(db, { to: senior.userId, channels: ['voice'], title: 'Medicine reminder again', body: `Please take ${d.medName} and press Taken.`, event: 'dose_reminder' });
    }
  }

  // FR-MED-09 low stock (7 days)
  for (const m of db.filter('medicines', (x) => x.active)) {
    const perDay = m.times.length * (m.doseQty || 1);
    if (perDay && m.stock / perDay <= 7 && (!m.lowStockAlertAt || now - m.lowStockAlertAt > 3 * DAY)) {
      m.lowStockAlertAt = now;
      notifyCircle(db, m.seniorId, { channels: ['push'], title: 'Medicine running low', body: `${m.name} will run out in ${Math.floor(m.stock / perDay)} days. Order a refill.`, event: 'refill' });
    }
  }

  for (const b of db.all('bookings')) {
    // FR-BKG-03 accept window
    if (b.status === 'requested' && b.acceptBy && now > b.acceptBy) {
      b.status = 'expired';
      (b.timeline ||= []).push({ at: now, text: 'Provider did not accept in time: full refund' });
      refund(db, { payment: db.get('payments', b.paymentId), amount: b.price.total, reason: 'Provider did not respond' });
      notifyCircle(db, b.seniorId, { channels: ['push', 'sms'], title: 'Booking not accepted', body: `${b.providerName} did not accept ${b.serviceName} in time. Your money is being refunded. Tap to choose the next best provider.`, event: 'booking_declined' });
      events.push(`Expired: ${b.serviceName} for ${b.seniorName}`);
    }
    // FR-BKG-09 no check-in alerts and no-show
    if (['assigned', 'accepted'].includes(b.status) && !b.checkInAt && now > b.start) {
      const late = (now - b.start) / MIN;
      const recent = now - b.start < RECENT;
      if (late >= c.noShowAlertProviderMin && !b.alerts?.provider15) {
        (b.alerts ||= {}).provider15 = now;
        if (recent) {
          const prov = db.get('providers', b.providerId);
          notify(db, { to: [prov?.adminUserId, db.get('caregivers', b.caregiverId)?.userId].filter(Boolean), channels: ['push', 'voice'], title: 'Visit not started', body: `${b.serviceName} for ${b.seniorName} started 15 minutes ago and nobody has checked in.`, event: 'late' });
          notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Late visit', body: `${b.seniorName}: ${b.caregiverName || b.providerName} not checked in`, event: 'late' });
          events.push(`Late (15 min): ${b.serviceName} for ${b.seniorName}`);
        }
      }
      if (late >= c.noShowAlertFamilyMin && !b.alerts?.family30) {
        b.alerts.family30 = now;
        if (recent) {
          notifyCircle(db, b.seniorId, { channels: ['push', 'sms'], title: 'Caregiver has not arrived', body: `${b.caregiverName || b.providerName} has not checked in for ${b.serviceName}. Choose "Find replacement" or "Refund" in the app.`, event: 'late' });
          events.push(`Family alerted (30 min): ${b.seniorName}`);
        }
      }
      if (now > b.end + HOUR) {
        b.status = 'no_show';
        (b.timeline ||= []).push({ at: now, text: 'No check-in: marked no-show, full refund' });
        if (b.paymentId) refund(db, { payment: db.get('payments', b.paymentId), amount: b.price.total, reason: 'Caregiver no-show' });
        events.push(`No-show: ${b.serviceName} for ${b.seniorName}`);
      }
    }
    // FR-BKG-10 silence counts as confirmation after 24 hours
    if (b.status === 'completed' && b.completedAt && now - b.completedAt >= c.autoConfirmHours * HOUR) {
      confirmBooking(db, b, null);
      events.push(`Auto-confirmed: ${b.serviceName} for ${b.seniorName}`);
    }
  }

  const paid = runPayouts(db);
  if (paid) events.push(`${paid} payout(s) sent (T+2)`);

  // FR-SUB-04 renewals, retries on days 1, 3 and 5, 7-day SOS grace
  for (const s of db.filter('subscriptions', (x) => ['active', 'grace', 'cancelling'].includes(x.status))) {
    const senior = db.get('seniors', s.seniorId);
    if (s.status === 'cancelling' && now >= s.cancelAt) { s.status = 'cancelled'; s.endedAt = now; events.push(`Plan ended: ${senior.name}`); continue; }
    if (s.status === 'active' && now >= s.nextBillingAt) {
      if (s.pendingPlanId) { s.planId = s.pendingPlanId; s.pendingPlanId = null; }
      const p2 = db.get('plans', s.planId);
      if (s.failNext) {
        Object.assign(s, { status: 'grace', graceUntil: s.nextBillingAt + c.graceDays * DAY, failCount: 1, nextRetryAt: s.nextBillingAt + DAY, failedAt: now });
        notifyCircle(db, s.seniorId, { channels: ['push', 'sms'], title: 'Renewal failed', body: `We could not renew ${senior.name}'s ${p2.name} plan. We'll retry on days 1, 3 and 5. SOS stays active for 7 days.`, event: 'renewal' });
        events.push(`Renewal failed: ${senior.name}`);
      } else {
        const pay = capture(db, { userId: s.payerId, seniorId: s.seniorId, amount: p2.price, purpose: `${p2.name} plan renewal`, method: s.method, subscriptionId: s.id, mandateId: s.mandateId });
        s.payments.push(pay.id);
        s.periodStart = s.nextBillingAt; s.periodEnd = s.nextBillingAt + 30 * DAY; s.nextBillingAt = s.periodEnd;
        scheduleCheckVisits(db, s, now);
        events.push(`Renewed: ${senior.name} ${p2.name}`);
      }
    }
    if (s.status === 'grace') {
      if (now >= s.graceUntil) {
        s.status = 'lapsed'; s.endedAt = now;
        notifyCircle(db, s.seniorId, { channels: ['push', 'sms'], title: 'Plan lapsed', body: `${senior.name}'s plan has lapsed after 7 days. SOS from the plan is now off. Renew any time.`, event: 'renewal' });
        events.push(`Plan lapsed: ${senior.name}`);
      } else if (now >= s.nextRetryAt) {
        const day = Math.round((s.nextRetryAt - (s.graceUntil - c.graceDays * DAY)) / DAY);
        s.failCount += 1;
        const next = { 1: 3, 3: 5 }[day];
        s.nextRetryAt = next ? s.graceUntil - c.graceDays * DAY + next * DAY : s.graceUntil;
        notifyCircle(db, s.seniorId, { channels: ['push', 'sms'], title: `Retry ${s.failCount - 1} failed`, body: `Renewal retry on day ${day} failed for ${senior.name}'s plan. Please update the payment method.`, event: 'renewal' });
        events.push(`Renewal retry day ${day} failed: ${senior.name}`);
      }
    }
  }

  // FR-SAF-01 daily "Are you OK?" check-in
  const today = istDateKey(now);
  for (const s of db.filter('seniors', (x) => x.checkinSettings?.enabled && !x.background)) {
    const at = istTime(today, s.checkinSettings.time);
    if (now < at || now - at > 3 * HOUR) continue;
    let ci = db.find('checkins', (x) => x.seniorId === s.id && x.date === today);
    if (!ci) {
      ci = db.insert('checkins', { seniorId: s.id, date: today, attempts: 1, status: 'calling', firstCallAt: now }, 'chk');
      notify(db, { to: s.userId, toName: s.name, toPhone: s.mobile, channels: s.userId ? ['push', 'voice'] : ['voice'], title: 'Are you OK today?', body: 'Good morning! Press "I am OK" in the app, or press 1 on this call.', event: 'checkin', seniorId: s.id });
      events.push(`Check-in call: ${s.name}`);
    } else if (['calling', 'pending'].includes(ci.status)) {
      if (ci.attempts < 2 && now - at >= 15 * MIN) {
        ci.attempts = 2;
        notify(db, { to: s.userId, toName: s.name, toPhone: s.mobile, channels: ['voice'], title: 'Are you OK today? (2nd try)', body: 'Please press 1 if you are OK.', event: 'checkin', seniorId: s.id });
      } else if (ci.attempts >= 2 && now - at >= 30 * MIN) {
        ci.status = 'no_answer';
        notifyCircle(db, s.id, { channels: ['push', 'sms'], title: `${s.name} did not answer`, body: `${s.name} did not answer today's check-in twice. Your coordinator will call within 30 minutes.`, event: 'checkin' });
        notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Missed check-in', body: `${s.name}: call within 30 minutes`, event: 'checkin' });
        events.push(`Missed check-in: ${s.name}`);
      }
    }
  }

  // FR-EMG-04 escalate unacknowledged SOS after 45 seconds
  for (const cs of db.filter('cases', (x) => x.status === 'open' && !x.escalatedAt && now - x.createdAt > c.sosEscalateSec * 1000)) {
    cs.escalatedAt = now;
    cs.timeline.push({ at: now, kind: 'escalate', text: `Not acknowledged in ${c.sosEscalateSec} s: supervisor paged` });
    notifyStaff(db, 'admin', { channels: ['push', 'voice'], title: 'SOS escalation', body: `${cs.seniorName}'s SOS not acknowledged in ${c.sosEscalateSec} s`, event: 'sos', critical: true });
    events.push(`SOS escalated to supervisor: ${cs.seniorName}`);
  }

  // FR-SCM-02 coordinator takes over if family does not answer in 2 minutes
  for (const r of db.filter('scamReports', (x) => x.status === 'calling family' && x.escalateAt <= now)) {
    r.status = 'coordinator calling';
    notifyStaff(db, 'coordinator', { channels: ['push', 'voice'], title: 'Verify before you pay', body: `${db.get('seniors', r.seniorId)?.name} needs a call now (family did not answer).`, event: 'scam_verify', critical: true });
  }

  // FR-VER-10 expiry warnings and expiry
  for (const cg of db.filter('caregivers', (x) => x.status === 'verified' && x.registrationExpiry)) {
    const exp = Date.parse(cg.registrationExpiry);
    if (now >= exp) { setCaregiverStatus(db, cg, 'expired', null, 'Registration expired'); events.push(`Registration expired: ${cg.name}`); }
    else if (exp - now <= 30 * DAY && !cg.expiryWarnedAt) {
      cg.expiryWarnedAt = now;
      if (cg.userId) notify(db, { to: cg.userId, channels: ['push', 'sms'], title: 'Registration expiring', body: `Your nursing registration expires on ${cg.registrationExpiry}. Upload the renewal to keep your listings live.`, event: 'expiry' });
    }
  }

  // equipment delivery
  for (const o of db.filter('equipmentOrders', (x) => x.status === 'scheduled' && x.slot <= now)) { o.status = 'active'; o.deliveredAt = now; }

  db.dirty = true;
  return events;
}

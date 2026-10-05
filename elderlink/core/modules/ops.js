// FR-ADM (operations and admin consoles), FR-VER (verification queue), FR-GRV (grievances),
// FR-REV-09 (moderation), FR-ADM-08 (suspension), FR-ADM-06 (reports).
import { assert, fail, DAY, HOUR } from '../util.js';
import { audit, badgesFor, caregiverQuality, config, isStaff, notify, notifyCircle, providerCard, requireRole } from '../context.js';
import { qualityBand } from '../rules.js';
import { CAREGIVER_CATEGORIES, GRIEVANCE_CATEGORIES } from '../catalog.js';
import { cancelBooking } from './bookings.js';
import { refund, addCredit } from '../payments.js';

function staffOnly(user) { requireRole(user, 'coordinator', 'emergency', 'admin'); }

/** FR-VER-09: move status and log it; listings follow provider status. */
export function setCaregiverStatus(db, cg, to, by, reason) {
  db.insert('verificationLog', { caregiverId: cg.id, from: cg.status, to, by: by?.name || 'System', reason: reason || '' }, 'vlg');
  cg.status = to;
  cg.lastChecked = db.now();
  const p = db.get('providers', cg.providerId);
  if (p.type === 'independent') {
    p.status = to === 'verified' ? 'verified' : to;
    p.lastChecked = db.now();
    for (const l of db.filter('listings', (x) => x.providerId === p.id)) {
      if (to === 'verified' && l.status === 'draft' && !l.flag) l.status = 'published';
      if (['suspended', 'expired', 'rejected'].includes(to) && l.status === 'published') l.status = 'hidden';
      if (to === 'verified' && l.status === 'hidden') l.status = 'published';
    }
  }
  db.dirty = true;
}

/** FR-ADM-08: suspend, hide listings, reassign future bookings, tell affected families. */
export function suspendProvider(db, provider, by, reason) {
  provider.status = 'suspended';
  for (const l of db.filter('listings', (x) => x.providerId === provider.id && x.status === 'published')) l.status = 'hidden';
  for (const cg of db.filter('caregivers', (c) => c.providerId === provider.id)) if (cg.status === 'verified') setCaregiverStatus(db, cg, 'suspended', by, reason);
  const affected = db.filter('bookings', (b) => b.providerId === provider.id && ['requested', 'accepted', 'assigned'].includes(b.status) && b.start > db.now());
  for (const b of affected) {
    cancelBooking(db, b, 'provider', by, 'Provider suspended');
    notifyCircle(db, b.seniorId, { channels: ['push', 'sms'], title: 'We are replacing your provider', body: `${provider.name} is no longer available. ${b.serviceName} on ${new Date(b.start).toLocaleDateString('en-IN')} is refunded in full; your coordinator will help you rebook.`, event: 'suspension' });
  }
  audit(db, by, 'provider.suspend', provider.id, { reason, affected: affected.length });
  db.dirty = true;
  return affected.length;
}

export function grievanceView(db, g) {
  const now = db.now();
  return { ...g, ackOverdue: !g.ackAt && now > g.ackDueAt, resolveOverdue: g.status !== 'resolved' && now > g.resolveDueAt, officer: config(db).grievanceOfficer };
}

export function routes(r) {
  // ---- verification queue (FR-ADM-02) ----
  r('GET', '/ops/verification', ({ db, user }) => {
    staffOnly(user);
    return db.filter('caregivers', (c) => ['submitted', 'under_review', 'expired'].includes(c.status) || (c.status === 'verified' && c.registrationExpiry && Date.parse(c.registrationExpiry) - db.now() < 30 * DAY))
      .map((c) => ({ ...c, provider: db.get('providers', c.providerId)?.name, providerType: db.get('providers', c.providerId)?.type, categoryLabel: CAREGIVER_CATEGORIES[c.category]?.label, log: db.filter('verificationLog', (v) => v.caregiverId === c.id) }));
  });
  r('POST', '/ops/verification/:id', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const cg = db.get('caregivers', params.id);
    assert(cg, 404, 'Not found');
    const v = { ...(cg.verification || {}) };
    for (const k of ['id', 'registration', 'police', 'references', 'interview']) if (body.checks?.[k]) v[k] = body.checks[k];
    cg.verification = v;
    if (body.checks?.registration === 'pass') cg.registrationCheckedAt = db.now();
    const a = body.action;
    if (a === 'review') setCaregiverStatus(db, cg, 'under_review', user, 'Review started');
    else if (a === 'approve') {
      const nurse = CAREGIVER_CATEGORIES[cg.category]?.nurse;
      assert(v.id === 'pass' && v.police === 'pass' && v.interview === 'pass', 400, 'ID, police verification and the video interview must all pass first');
      if (nurse) assert(v.registration === 'pass', 400, 'Registration verification pending');
      assert((cg.inductionScore || 0) >= 80, 400, 'The caregiver must finish induction training with at least 80% first');
      setCaregiverStatus(db, cg, 'verified', user, body.reason || 'All checks passed');
      if (cg.userId) notify(db, { to: cg.userId, channels: ['push', 'sms'], title: 'You are verified', body: 'Congratulations, your ElderLink profile is verified. Your listings are now live.', event: 'verification' });
    } else if (a === 'reject') {
      assert(body.reason, 400, 'Give a reason');
      setCaregiverStatus(db, cg, 'rejected', user, body.reason);
      if (cg.userId) notify(db, { to: cg.userId, channels: ['push', 'sms'], title: 'Verification not approved', body: body.reason, event: 'verification' });
    } else if (a === 'suspend') {
      assert(body.reason, 400, 'Give a reason');
      const p = db.get('providers', cg.providerId);
      if (p.type === 'independent') suspendProvider(db, p, user, body.reason); else setCaregiverStatus(db, cg, 'suspended', user, body.reason);
    } else if (a === 'reinstate') setCaregiverStatus(db, cg, 'verified', user, body.reason || 'Reinstated after review');
    else if (a !== 'update') fail(400, 'Unknown action');
    audit(db, user, `verification.${a}`, cg.id, body.checks);
    db.dirty = true;
    return { ...cg, badges: badgesFor(db, cg) };
  });

  r('POST', '/ops/providers/:id/suspend', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const p = db.get('providers', params.id);
    assert(p, 404, 'Not found');
    assert(body.reason, 400, 'Give a reason');
    const n = suspendProvider(db, p, user, body.reason);
    return { ok: true, affected: n };
  });
  r('POST', '/ops/providers/:id/verify-facility', ({ db, user, params }) => {
    requireRole(user, 'coordinator', 'admin');
    const p = db.get('providers', params.id);
    p.verification = { ...(p.verification || {}), facility: 'pass' };
    p.status = 'verified'; p.lastChecked = db.now();
    db.dirty = true;
    return p;
  });

  r('GET', '/ops/providers', ({ db, user }) => {
    staffOnly(user);
    return db.all('providers').filter((p) => !p.background).map((p) => ({ ...providerCard(db, p), status: p.status }));
  });

  // ---- quality tickets (FR-REV-08, FR-ADM-03) ----
  r('GET', '/ops/tickets', ({ db, user }) => {
    staffOnly(user);
    return db.all('qualityTickets').slice().sort((a, b) => (a.status === 'open' ? -1 : 1) - (b.status === 'open' ? -1 : 1) || b.createdAt - a.createdAt)
      .map((t) => ({ ...t, caregiverName: db.get('caregivers', t.caregiverId)?.name, providerName: db.get('providers', t.providerId)?.name, quality: t.caregiverId ? caregiverQuality(db, t.caregiverId).score : null }));
  });
  r('POST', '/ops/tickets/:id', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const t = db.get('qualityTickets', params.id);
    assert(t, 404, 'Not found');
    if (body.replacementCaregiverId && t.bookingId) {
      // backup guarantee: book the replacement visit at no extra cost
      const old = db.get('bookings', t.bookingId);
      const cg = db.get('caregivers', body.replacementCaregiverId);
      assert(cg && cg.status === 'verified', 400, 'Choose a verified caregiver');
      const nb = db.insert('bookings', { ...old, id: undefined, createdAt: undefined, providerId: cg.providerId, providerName: db.get('providers', cg.providerId).name, caregiverId: cg.id, caregiverName: cg.name, status: 'assigned', assignedAt: db.now(), paymentId: null, price: { ...old.price, total: 0 }, notes: 'Replacement under backup guarantee', timeline: [{ at: db.now(), text: `Replacement assigned by ${user.name} (backup guarantee)` }], alerts: {}, checkInAttempts: 0, cancelledBy: undefined, cancelledAt: undefined }, 'bkg');
      notifyCircle(db, old.seniorId, { channels: ['push', 'sms'], title: 'Replacement caregiver', body: `${cg.name} will cover ${old.serviceName} at the same time. No extra charge.`, event: 'caregiver_assigned' }, { includeSenior: true });
      t.replacementBookingId = nb.id;
    }
    t.status = body.status || 'resolved';
    t.resolution = body.resolution || '';
    t.resolvedBy = user.name; t.resolvedAt = db.now();
    db.dirty = true;
    return t;
  });

  // ---- grievances (FR-GRV) ----
  r('POST', '/grievances', ({ db, user, body }) => {
    assert(GRIEVANCE_CATEGORIES.includes(body.category) || body.type === 'dpdp', 400, 'Pick a category');
    assert(body.text?.trim(), 400, 'Tell us what happened');
    const p0 = body.category === 'Safety / abuse';
    const g = db.insert('grievances', { userId: user.id, userName: user.name, seniorId: body.seniorId || null, bookingId: body.bookingId || null, category: body.category || 'Data privacy', type: body.type || 'complaint', subject: body.subject || body.category, text: body.text.trim(), channel: body.channel || 'app', priority: p0 ? 'P0' : 'normal', status: 'open', ackDueAt: db.now() + (p0 ? 1 : 48) * HOUR, resolveDueAt: db.now() + (p0 ? 24 : 30 * 24) * HOUR }, 'grv');
    notify(db, { to: user.id, channels: ['push', 'sms'], title: 'Complaint received', body: `We have logged your complaint (${g.id}). Grievance officer: ${config(db).grievanceOfficer.name}.`, event: 'grievance' });
    return grievanceView(db, g);
  });
  r('GET', '/grievances', ({ db, user }) => {
    const rows = isStaff(user) ? db.all('grievances') : db.filter('grievances', (g) => g.userId === user.id);
    return rows.slice().sort((a, b) => b.createdAt - a.createdAt).map((g) => grievanceView(db, g));
  });
  r('POST', '/ops/grievances/:id', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const g = db.get('grievances', params.id);
    assert(g, 404, 'Not found');
    if (body.action === 'ack') { g.ackAt = db.now(); g.status = 'in_progress'; g.ackBy = user.name; }
    if (body.action === 'resolve') {
      assert(body.outcome, 400, 'Choose an outcome');
      Object.assign(g, { status: 'resolved', outcome: body.outcome, resolution: body.note || '', resolvedAt: db.now(), resolvedBy: user.name, substantiated: !!body.substantiated });
      if (!g.ackAt) g.ackAt = db.now();
      const b = g.bookingId ? db.get('bookings', g.bookingId) : null;
      if (b) {
        const pay = b.paymentId ? db.get('payments', b.paymentId) : null;
        if (body.outcome === 'Refund' && pay) refund(db, { payment: pay, amount: Math.max(0, pay.amount - (pay.refunded || 0)), reason: 'Complaint resolved with refund' });
        if (body.outcome === 'Credit') addCredit(db, g.userId, Number(body.amount) || 300, 'Complaint goodwill credit');
        if (b.status === 'disputed') {
          // FR-PAY-06: release or cancel the frozen payout
          b.status = body.outcome === 'Refund' ? 'cancelled' : 'completed';
          b.timeline.push({ at: db.now(), text: `Dispute resolved: ${body.outcome}` });
          const po = db.find('payouts', (p) => p.bookingId === b.id);
          if (po && po.status === 'held') po.status = body.outcome === 'Refund' ? 'cancelled' : 'scheduled';
        }
      }
      if (body.outcome === 'Suspension' && g.providerId) suspendProvider(db, db.get('providers', g.providerId), user, `Complaint ${g.id}`);
      notify(db, { to: g.userId, channels: ['push', 'sms'], title: 'Complaint resolved', body: `Outcome: ${body.outcome}. ${body.note || ''}`, event: 'grievance' });
    }
    if (body.action === 'note') (g.notes ||= []).push({ at: db.now(), by: user.name, text: body.note });
    audit(db, user, `grievance.${body.action}`, g.id);
    db.dirty = true;
    return grievanceView(db, g);
  });

  // ---- coordinator workspace (FR-ADM-03) ----
  r('GET', '/ops/checkvisits', ({ db, user }) => {
    staffOnly(user);
    return db.filter('bookings', (b) => b.isCheckVisit && b.start > db.now() - DAY && ['accepted', 'assigned'].includes(b.status)).sort((a, b) => a.start - b.start)
      .map((b) => ({ ...b, preferred: b.preferredCaregiverId ? db.get('caregivers', b.preferredCaregiverId)?.name : null }));
  });
  r('GET', '/ops/nurses', ({ db, user }) => {
    staffOnly(user);
    return db.filter('caregivers', (c) => c.status === 'verified').map((c) => ({ id: c.id, name: c.name, category: c.category, categoryLabel: CAREGIVER_CATEGORIES[c.category]?.label, provider: db.get('providers', c.providerId)?.name, quality: caregiverQuality(db, c.id).score }));
  });
  r('GET', '/ops/supply', ({ db, user }) => { staffOnly(user); return db.all('supplyRequests').slice().reverse(); });
  r('POST', '/ops/supply/:id', ({ db, user, params, body }) => { staffOnly(user); const s = db.get('supplyRequests', params.id); s.status = body.status || 'sourcing'; s.note = body.note; db.dirty = true; return s; });
  r('GET', '/ops/flags', ({ db, user }) => {
    staffOnly(user);
    return db.filter('listings', (l) => l.flag || l.status === 'review').map((l) => ({ ...l, provider: db.get('providers', l.providerId)?.name, service: db.get('services', l.serviceId)?.name, median: db.get('services', l.serviceId)?.medianPrice }));
  });
  r('POST', '/ops/flags/:id', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const l = db.get('listings', params.id);
    assert(l, 404, 'Not found');
    const p = db.get('providers', l.providerId);
    if (body.action === 'approve') { l.flag = null; l.status = p.status === 'verified' ? 'published' : 'draft'; }
    if (body.action === 'reject') { l.status = 'unpublished'; }
    l.reviewNote = body.note || '';
    audit(db, user, `listing.price_${body.action}`, l.id);
    db.dirty = true;
    return l;
  });

  r('GET', '/ops/reviews/held', ({ db, user }) => { staffOnly(user); return db.filter('reviews', (rv) => rv.status === 'held'); });
  r('POST', '/ops/reviews/:id', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const rv = db.get('reviews', params.id);
    assert(rv, 404, 'Not found');
    if (body.action === 'publish') rv.status = 'published';
    if (body.action === 'remove') { assert(['abuse', 'personal data', 'proven fraud'].includes(body.reason), 400, 'Reviews can be removed only for abuse, personal data or proven fraud'); rv.status = 'removed'; rv.removedReason = body.reason; }
    audit(db, user, `review.${body.action}`, rv.id, { reason: body.reason });
    db.dirty = true;
    return rv;
  });

  r('GET', '/ops/followups', ({ db, user }) => {
    staffOnly(user);
    return db.filter('cases', (c) => c.status === 'closed' && !c.followUp).map((c) => ({ id: c.id, seniorName: c.seniorName, outcome: c.outcome, closedAt: c.closedAt, dueAt: c.followUpDueAt }));
  });

  // ---- admin (FR-ADM-05) ----
  r('GET', '/admin/config', ({ db, user }) => { requireRole(user, 'admin'); return config(db); });
  r('PATCH', '/admin/config', ({ db, user, body }) => {
    requireRole(user, 'admin');
    const c = { ...config(db) };
    for (const k of ['commissionPct', 'trustedCommissionPct', 'platformFee', 'approvalThreshold', 'medianLowFlagPct', 'checkInRadiusM']) if (body[k] != null) c[k] = Number(body[k]);
    if (body.qualityWeights) c.qualityWeights = body.qualityWeights;
    if (body.vitalThresholds) c.vitalThresholds = body.vitalThresholds;
    db.data.meta.config = c;
    audit(db, user, 'config.update', 'config', body);
    db.dirty = true;
    return c;
  });
  r('PATCH', '/admin/services/:id', ({ db, user, params, body }) => {
    requireRole(user, 'admin');
    const s = db.get('services', params.id);
    assert(s, 404, 'Not found');
    if (body.medianPrice) s.medianPrice = Number(body.medianPrice);
    if (body.active !== undefined) s.active = !!body.active;
    if (body.allowed) s.allowed = body.allowed;
    audit(db, user, 'service.update', s.id, body);
    db.dirty = true;
    return s;
  });
  r('POST', '/admin/services', ({ db, user, body }) => {
    requireRole(user, 'admin');
    assert(body.name && body.unit && body.medianPrice && body.allowed?.length, 400, 'Name, unit, median price and allowed categories are needed');
    const s = db.insert('services', { id: 'svc_' + body.name.toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 20), name: body.name, category: body.category || 'care', icon: 'nurse', allowed: body.allowed, unit: body.unit, medianPrice: Number(body.medianPrice), checklist: body.checklist || 'nursing' });
    audit(db, user, 'service.create', s.id);
    return s;
  });
  r('PATCH', '/admin/plans/:id', ({ db, user, params, body }) => {
    requireRole(user, 'admin');
    const p = db.get('plans', params.id);
    assert(p, 404, 'Not found');
    for (const k of ['price', 'checkVisits', 'discountPct']) if (body[k] != null) p[k] = Number(body[k]);
    if (body.coordinator != null) p.coordinator = !!body.coordinator;
    audit(db, user, 'plan.update', p.id, body);
    db.dirty = true;
    return p;
  });
  r('GET', '/admin/audit', ({ db, user }) => { requireRole(user, 'admin'); return db.all('audit').slice(-200).reverse(); });
  r('GET', '/admin/users', ({ db, user }) => { requireRole(user, 'admin'); return db.all('users').filter((u) => !u.background).map((u) => ({ id: u.id, name: u.name, role: u.role, mobile: u.mobile, createdAt: u.createdAt })); });

  // FR-ADM-06 reports
  r('GET', '/admin/reports', ({ db, user }) => {
    requireRole(user, 'admin', 'coordinator');
    const now = db.now();
    const since = now - 30 * DAY;
    const bookings = db.all('bookings');
    const recent = bookings.filter((b) => b.start >= since && b.start <= now);
    const gmv = recent.filter((b) => ['completed', 'confirmed', 'paid_out'].includes(b.status)).reduce((s, b) => s + (b.price?.careValue || 0), 0);
    const byStatus = {};
    for (const b of recent) byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    const subs = db.all('subscriptions');
    const active = subs.filter((s) => ['active', 'grace', 'cancelling'].includes(s.status));
    const byPlan = {};
    for (const s of active) { const n = db.get('plans', s.planId)?.name; byPlan[n] = (byPlan[n] || 0) + 1; }
    const lapsed = subs.filter((s) => ['lapsed', 'cancelled'].includes(s.status) && (s.endedAt || 0) >= since).length;
    const mrr = active.reduce((s, x) => s + (db.get('plans', x.planId)?.price || 0), 0);
    const cases = db.all('cases').filter((c) => c.ackAt);
    const ackTimes = cases.map((c) => (c.ackAt - c.createdAt) / 1000).sort((a, b) => a - b);
    const p = (q) => (ackTimes.length ? Math.round(ackTimes[Math.min(ackTimes.length - 1, Math.floor(q * ackTimes.length))]) : null);
    const quality = { excellent: 0, good: 0, fair: 0, review: 0, new: 0 };
    for (const c of db.filter('caregivers', (x) => x.status === 'verified')) quality[qualityBand(caregiverQuality(db, c.id).score).key]++;
    const supply = {};
    for (const l of db.filter('listings', (x) => x.status === 'published')) { const n = db.get('services', l.serviceId)?.name; supply[n] = (supply[n] || 0) + 1; }
    const gr = db.all('grievances');
    const commission = recent.filter((b) => ['confirmed', 'paid_out'].includes(b.status)).reduce((s, b) => s + (b.price?.elderlinkFee || 0), 0);
    return {
      gmv, commission, bookings: recent.length, byStatus, subscriptions: active.length, byPlan, churnPct: active.length ? Math.round((lapsed / (active.length + lapsed)) * 1000) / 10 : 0, mrr,
      sos: { cases: db.all('cases').filter((c) => c.createdAt >= since).length, p50: p(0.5), p95: p(0.95), under60: ackTimes.length ? Math.round((ackTimes.filter((t) => t <= 60).length / ackTimes.length) * 100) : null },
      quality, supply, grievances: { open: gr.filter((g) => g.status !== 'resolved').length, ackOverdue: gr.filter((g) => !g.ackAt && now > g.ackDueAt).length, resolved: gr.filter((g) => g.status === 'resolved').length },
      providers: db.filter('providers', (x) => x.status === 'verified' && !x.background).length, seniors: db.all('seniors').filter((s) => !s.background).length,
    };
  });
}

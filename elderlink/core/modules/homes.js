// Home screens: one call per role so the app opens fast on slow networks.
// FR-DSH-01 (family), FR-DSH-05 (senior: four tiles), caregiver, provider and operations homes.
import { istDateKey, istTime, DAY, HOUR } from '../util.js';
import { caregiverFor, caregiverQuality, circleMembers, config, providerAdminFor, providerQuality, requireRole, badgesFor } from '../context.js';
import { adherence, vitalsStatus } from '../rules.js';
import { seniorsFor, seniorView } from './seniors.js';
import { bookingView, OPEN_STATES } from './bookings.js';
import { grievanceView } from './ops.js';
import { creditBalance } from '../payments.js';
import { CAREGIVER_CATEGORIES } from '../catalog.js';

function todayRange(db) {
  const key = istDateKey(db.now());
  const from = istTime(key, '00:00');
  return { key, from, to: from + DAY };
}

export function seniorSnapshot(db, s, user) {
  const { from, to } = todayRange(db);
  const now = db.now();
  const visitsToday = db.filter('bookings', (b) => b.seniorId === s.id && b.start >= from && b.start < to && !['cancelled', 'declined', 'expired'].includes(b.status)).sort((a, b) => a.start - b.start);
  const doses = db.filter('doses', (d) => d.seniorId === s.id && d.due >= from && d.due < to);
  const lastVitals = db.filter('vitals', (v) => v.seniorId === s.id).sort((a, b) => b.at - a.at)[0] || null;
  const nextCheck = db.filter('bookings', (b) => b.seniorId === s.id && b.isCheckVisit && b.start > now && OPEN_STATES.includes(b.status)).sort((a, b) => a.start - b.start)[0] || null;
  const nextVisit = db.filter('bookings', (b) => b.seniorId === s.id && b.start > now - 2 * HOUR && OPEN_STATES.includes(b.status) && b.status !== 'pending_approval').sort((a, b) => a.start - b.start)[0] || null;
  const alerts = [];
  for (const c of db.filter('cases', (x) => x.seniorId === s.id && x.status !== 'closed')) alerts.push({ kind: 'sos', level: 'red', text: `SOS in progress: ${c.status.replace('_', ' ')}`, id: c.id });
  for (const d of doses.filter((x) => x.status === 'missed')) alerts.push({ kind: 'dose', level: d.critical ? 'red' : 'amber', text: `Missed ${d.medName} (${d.time})`, id: d.id });
  for (const b of db.filter('bookings', (x) => x.seniorId === s.id && x.status === 'pending_approval')) alerts.push({ kind: 'approval', level: 'amber', text: `Approval needed: ${b.serviceName} (Rs ${b.price.total})`, id: b.id });
  for (const b of db.filter('bookings', (x) => x.seniorId === s.id && x.status === 'completed')) alerts.push({ kind: 'confirm', level: 'info', text: `Confirm visit: ${b.serviceName} by ${b.caregiverName}`, id: b.id });
  for (const b of visitsToday.filter((x) => x.alerts?.family30 && ['assigned', 'accepted'].includes(x.status))) alerts.push({ kind: 'late', level: 'red', text: `${b.caregiverName || b.providerName} has not checked in for ${b.serviceName}`, id: b.id });
  if (lastVitals) { const st = vitalsStatus(lastVitals, config(db).vitalThresholds); if (st.overall === 'red' && now - lastVitals.at < 3 * DAY) alerts.push({ kind: 'vitals', level: 'red', text: 'Last vitals were outside safe range', id: lastVitals.id }); }
  const ci = db.find('checkins', (c) => c.seniorId === s.id && c.date === istDateKey(now));
  if (ci?.status === 'no_answer') alerts.push({ kind: 'checkin', level: 'red', text: 'Did not answer the daily check-in', id: ci.id });
  if (ci?.status === 'needs_help') alerts.push({ kind: 'checkin', level: 'red', text: 'Said "I need help" at the daily check-in', id: ci.id });
  const sub = db.find('subscriptions', (x) => x.seniorId === s.id && ['active', 'grace', 'cancelling'].includes(x.status));
  if (sub?.status === 'grace') alerts.push({ kind: 'billing', level: 'amber', text: 'Plan renewal failed: SOS stays on during the 7-day grace period', id: sub.id });
  const weekDoses = db.filter('doses', (d) => d.seniorId === s.id && d.due >= now - 7 * DAY && d.due <= now);
  return {
    senior: seniorView(db, s, null),
    visitsToday: visitsToday.map((b) => bookingView(db, b, user)),
    doses: { total: doses.length, taken: doses.filter((d) => d.status === 'taken').length, missed: doses.filter((d) => d.status === 'missed').length, upcoming: doses.filter((d) => d.due > now && d.status === 'due').length, adherence7: adherence(weekDoses) },
    lastVitals: lastVitals ? { ...lastVitals, status: vitalsStatus(lastVitals, config(db).vitalThresholds) } : null,
    nextCheck: nextCheck ? bookingView(db, nextCheck, user) : null,
    nextVisit: nextVisit ? bookingView(db, nextVisit, user) : null,
    alerts, checkin: ci || null,
    subscription: sub ? { id: sub.id, status: sub.status, plan: db.get('plans', sub.planId)?.name, nextBillingAt: sub.nextBillingAt, coordinator: db.get('users', sub.coordinatorId)?.name } : null,
  };
}

export function routes(r) {
  r('GET', '/family/home', ({ db, user }) => {
    const seniors = seniorsFor(db, user);
    const since = db.now() - 30 * DAY;
    const spend = db.filter('payments', (p) => p.userId === user.id && p.createdAt >= since).reduce((s, p) => s + p.amount - (p.refunded || 0), 0);
    return { seniors: seniors.map((s) => seniorSnapshot(db, s, user)), spend30: spend, credit: creditBalance(db, user.id), unread: db.filter('notifications', (n) => n.userId === user.id && !n.read && n.channel === 'push').length };
  });

  r('GET', '/senior/home', ({ db, user }) => {
    const s = db.find('seniors', (x) => x.userId === user.id);
    if (!s) return { senior: null };
    const snap = seniorSnapshot(db, s, user);
    const { from, to } = todayRange(db);
    const now = db.now();
    const doses = db.filter('doses', (d) => d.seniorId === s.id && d.due >= from && d.due < to).sort((a, b) => a.due - b.due).map((d) => ({ ...d, medicine: db.get('medicines', d.medicineId) }));
    const dueNow = doses.filter((d) => ['due', 'reminded', 'later', 'missed'].includes(d.status) && d.due <= now + 30 * 60000);
    const toReview = db.filter('bookings', (b) => b.seniorId === s.id && ['completed', 'confirmed'].includes(b.status) && b.checkOutAt && now - b.end < 7 * DAY && !db.find('reviews', (rv) => rv.bookingId === b.id && rv.reviewerType === 'senior')).sort((a, b) => b.end - a.end)[0];
    const pendingRequests = db.filter('bookings', (b) => b.seniorId === s.id && b.status === 'pending_approval' && b.bookedBy === user.id).map((b) => ({ id: b.id, serviceName: b.serviceName, serviceNameHi: b.serviceNameHi, start: b.start }));
    const family = circleMembers(db, s.id).filter((m) => m.status !== 'removed').map((m) => ({ userId: m.userId, name: m.user?.name, relation: m.relation, role: m.role, nominee: s.nominee === m.userId }));
    const ci = db.find('checkins', (c) => c.seniorId === s.id && c.date === istDateKey(now));
    const alert = db.all('scamAlerts')[Math.floor(now / (7 * DAY)) % Math.max(1, db.all('scamAlerts').length)];
    return {
      ...snap, dosesToday: doses, dueNow, family,
      toReview: toReview ? { id: toReview.id, caregiverName: toReview.caregiverName, serviceName: toReview.serviceName, serviceNameHi: toReview.serviceNameHi, end: toReview.end } : null,
      pendingRequests, askCheckin: s.checkinSettings?.enabled && (!ci || ['pending', 'calling'].includes(ci.status)), scamAlert: alert,
      openCase: db.find('cases', (c) => c.seniorId === s.id && c.status !== 'closed'),
    };
  });

  r('GET', '/caregiver/home', ({ db, user }) => {
    const cg = caregiverFor(db, user);
    if (!cg) return { caregiver: null };
    const now = db.now();
    const { from } = todayRange(db);
    const mine = db.filter('bookings', (b) => b.caregiverId === cg.id);
    const today = mine.filter((b) => b.start >= from && b.start < from + DAY && !['cancelled', 'declined'].includes(b.status)).sort((a, b) => a.start - b.start);
    const upcoming = mine.filter((b) => b.start >= from + DAY && OPEN_STATES.includes(b.status)).sort((a, b) => a.start - b.start).slice(0, 10);
    const provider = db.get('providers', cg.providerId);
    const requests = provider.type === 'independent' ? db.filter('bookings', (b) => b.providerId === provider.id && b.status === 'requested') : [];
    const payouts = db.filter('payouts', (p) => p.caregiverId === cg.id);
    const monthStart = now - 30 * DAY;
    return {
      caregiver: { ...cg, categoryLabel: CAREGIVER_CATEGORIES[cg.category]?.label, badges: badgesFor(db, cg) }, provider: { id: provider.id, name: provider.name, type: provider.type, status: provider.status },
      quality: caregiverQuality(db, cg.id),
      today: today.map((b) => ({ ...bookingView(db, b, user), address: db.get('seniors', b.seniorId)?.address, area: db.get('seniors', b.seniorId)?.area })),
      upcoming: upcoming.map((b) => bookingView(db, b, user)),
      requests: requests.map((b) => ({ ...bookingView(db, b, user), area: db.get('seniors', b.seniorId)?.area })),
      earnings: { month: payouts.filter((p) => p.createdAt >= monthStart).reduce((s, p) => s + p.amount, 0), scheduled: payouts.filter((p) => p.status === 'scheduled').reduce((s, p) => s + p.amount, 0), paid: payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0) },
      reviews: db.filter('reviews', (rv) => rv.caregiverId === cg.id && rv.status === 'published').sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    };
  });

  r('GET', '/provider/home', ({ db, user }) => {
    requireRole(user, 'provider_admin');
    const p = providerAdminFor(db, user);
    const now = db.now();
    const bookings = db.filter('bookings', (b) => b.providerId === p.id);
    const staff = db.filter('caregivers', (c) => c.providerId === p.id).map((c) => ({ id: c.id, name: c.name, category: c.category, categoryLabel: CAREGIVER_CATEGORIES[c.category]?.label, status: c.status, badges: badgesFor(db, c), quality: caregiverQuality(db, c.id).score, today: bookings.filter((b) => b.caregiverId === c.id && b.start >= now - 12 * HOUR && b.start < now + 12 * HOUR && OPEN_STATES.includes(b.status)).length }));
    return {
      provider: p, quality: providerQuality(db, p.id), staff,
      requests: bookings.filter((b) => b.status === 'requested').map((b) => bookingView(db, b, user)),
      toAssign: bookings.filter((b) => b.status === 'accepted').sort((a, b) => a.start - b.start).map((b) => bookingView(db, b, user)),
      upcoming: bookings.filter((b) => ['assigned', 'in_progress'].includes(b.status)).sort((a, b) => a.start - b.start).slice(0, 20).map((b) => bookingView(db, b, user)),
      recent: bookings.filter((b) => ['completed', 'confirmed', 'paid_out', 'disputed'].includes(b.status)).sort((a, b) => b.start - a.start).slice(0, 10).map((b) => bookingView(db, b, user)),
      reviews: db.filter('reviews', (rv) => rv.providerId === p.id && rv.status === 'published').sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    };
  });

  r('GET', '/ops/home', ({ db, user }) => {
    requireRole(user, 'coordinator', 'emergency', 'admin');
    const now = db.now();
    return {
      openCases: db.filter('cases', (c) => c.status !== 'closed').length,
      unackCases: db.filter('cases', (c) => c.status === 'open').length,
      verification: db.filter('caregivers', (c) => ['submitted', 'under_review'].includes(c.status)).length,
      tickets: db.filter('qualityTickets', (t) => t.status === 'open').length,
      grievances: db.filter('grievances', (g) => g.status !== 'resolved').map((g) => grievanceView(db, g)),
      unassignedChecks: db.filter('bookings', (b) => b.isCheckVisit && b.status === 'accepted' && b.start > now).length,
      supply: db.filter('supplyRequests', (s) => s.status === 'open').length,
      priceFlags: db.filter('listings', (l) => l.status === 'review').length,
      heldReviews: db.filter('reviews', (rv) => rv.status === 'held').length,
      scam: db.filter('scamReports', (s) => s.status !== 'advised').length,
      followups: db.filter('cases', (c) => c.status === 'closed' && !c.followUp).length,
      lateVisits: db.filter('bookings', (b) => ['assigned', 'accepted'].includes(b.status) && b.alerts?.provider15).map((b) => ({ id: b.id, seniorName: b.seniorName, caregiverName: b.caregiverName, serviceName: b.serviceName, start: b.start })),
      checkinMisses: db.filter('checkins', (c) => c.status === 'no_answer' && c.date === istDateKey(now)).map((c) => ({ id: c.id, seniorName: db.get('seniors', c.seniorId)?.name, seniorId: c.seniorId })),
    };
  });
}

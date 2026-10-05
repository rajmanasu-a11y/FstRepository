// FR-BKG (booking and visit execution), FR-REV (reviews), FR-FAM-03 (spend approvals),
// FR-CON-05 (senior asks for help, family approves).
import { assert, fail, haversineKm, randomDigits, istDateKey, istTime, addDaysKey, weekdayOfKey, HOUR, MIN, DAY } from '../util.js';
import {
  activity, audit, caregiverFor, circleRole, config, isStaff, isTrusted, notify, notifyCircle, notifyStaff,
  providerAdminFor, requireSenior, serviceById, bookingRating, badgesFor, caregiverQuality,
} from '../context.js';
import { cancellationCharge, priceBooking, reviewFraudFlags, reviewScore, vitalsStatus, nextStepFor, RATING_DIMENSIONS } from '../rules.js';
import { capture, refund, release, addCredit } from '../payments.js';
import { durationMin, slotsFor, listingView } from './marketplace.js';
import { CHECKLISTS, CAREGIVER_CATEGORIES } from '../catalog.js';

export const OPEN_STATES = ['pending_approval', 'requested', 'accepted', 'assigned', 'in_progress'];

function discountFor(db, seniorId) {
  const sub = db.find('subscriptions', (s) => s.seniorId === seniorId && ['active', 'grace'].includes(s.status));
  return sub ? db.get('plans', sub.planId)?.discountPct || 0 : 0;
}

export function quote(db, { listing, seniorId, addOnNames = [], qty = 1 }) {
  const addOns = (listing.addOns || []).filter((a) => addOnNames.includes(a.name));
  return { addOns, price: priceBooking({ minCharge: listing.minCharge, qty, addOns, discountPct: discountFor(db, seniorId), trusted: isTrusted(db, listing.providerId), config: config(db) }) };
}

function tl(b, text, db) { (b.timeline ||= []).push({ at: db.now(), text }); }

export function bookingView(db, b, user) {
  const cg = b.caregiverId ? db.get('caregivers', b.caregiverId) : null;
  const provider = db.get('providers', b.providerId);
  const report = db.find('visitReports', (r) => r.bookingId === b.id);
  const reviews = db.filter('reviews', (r) => r.bookingId === b.id);
  const role = user ? circleRole(db, user, b.seniorId) : null;
  const senior = db.get('seniors', b.seniorId);
  const isSeniorUser = user && senior?.userId === user.id;
  const pay = b.paymentId ? db.get('payments', b.paymentId) : null;
  return {
    ...b, myRole: role, providerType: provider?.type, providerPhone: 'Masked: +91 80 4000 0000',
    caregiver: cg ? { id: cg.id, name: cg.name, photo: cg.photo, category: CAREGIVER_CATEGORIES[cg.category]?.label, badges: badgesFor(db, cg), quality: caregiverQuality(db, cg.id).score } : null,
    seniorAddress: senior?.address, seniorArea: senior?.area,
    report, reviews: reviews.map((r) => ({ ...r, score: reviewScore(r.ratings) })), rating: bookingRating(db, b.id),
    payment: pay ? { id: pay.id, status: pay.status, amount: pay.amount, method: pay.method, refunded: pay.refunded || 0 } : null,
    invoices: db.filter('invoices', (i) => i.bookingId === b.id).map((i) => i.id),
    visitCode: isSeniorUser || ['owner', 'manager', 'viewer', 'staff'].includes(role) ? b.visitCode : undefined,
    canReview: canReview(db, b, user).ok,
    reviewBlockReason: canReview(db, b, user).reason,
  };
}

function canReview(db, b, user) {
  if (!user) return { ok: false };
  if (!['completed', 'confirmed', 'paid_out'].includes(b.status)) return { ok: false, reason: b.status === 'no_show' ? 'The visit did not happen, so it cannot be reviewed. You can raise a complaint instead.' : 'You can review after the visit is completed.' };
  if (!b.checkInAt || !b.checkOutAt) return { ok: false, reason: 'Only geo-verified visits can be reviewed.' };
  if (db.now() - b.end > 7 * DAY) return { ok: false, reason: 'Reviews close 7 days after the visit.' };
  const type = reviewerType(db, b, user);
  if (!type) return { ok: false, reason: 'Only the senior or the paying family can review.' };
  if (db.find('reviews', (r) => r.bookingId === b.id && r.reviewerType === type)) return { ok: false, reason: 'You have already reviewed this visit.' };
  return { ok: true, type };
}

function reviewerType(db, b, user) {
  const senior = db.get('seniors', b.seniorId);
  if (senior?.userId === user.id) return 'senior';
  const role = circleRole(db, user, b.seniorId);
  if (['owner', 'manager'].includes(role)) return 'payer';
  return null;
}

function needsApproval(db, seniorId, user, total, source) {
  const rule = db.find('approvalRules', (a) => a.seniorId === seniorId && a.enabled);
  const role = circleRole(db, user, seniorId);
  if (source === 'senior_request' || role === 'self' || role === 'viewer') return true;
  if (rule && total > rule.threshold && role !== 'owner') return true;
  return false;
}

/** Shared by the family booking flow, recurring bookings and senior requests. */
export function createBooking(db, user, { listingId, seniorId, start, addOnNames = [], notes = '', method = 'upi', useCredit = false, source = 'marketplace', recurrenceId = null, mandateId = null, forceApproval = false, skipSlotCheck = false }) {
  const listing = db.get('listings', listingId);
  assert(listing && listing.status === 'published', 400, 'This service is not available right now');
  const provider = db.get('providers', listing.providerId);
  assert(provider.status === 'verified', 400, 'This provider is not available right now');
  const { senior } = requireSenior(db, user, seniorId, source === 'senior_request' ? 'view' : 'view');
  const svc = serviceById(db, listing.serviceId);
  const dur = durationMin(listing.unit);
  start = Number(start);
  assert(start > db.now(), 400, 'Please pick a time in the future');
  if (!skipSlotCheck) {
    const slot = slotsFor(db, listing, istDateKey(start)).find((s) => s.start === start);
    assert(slot && slot.free, 409, 'That time was just taken. Please pick another slot.');
  }
  assert(haversineKm(senior, provider) <= listing.radiusKm, 400, 'This provider does not cover the senior\'s address');
  const { addOns, price } = quote(db, { listing, seniorId, addOnNames });
  const independent = provider.type === 'independent';
  const cg = independent ? db.find('caregivers', (c) => c.providerId === provider.id) : null;
  const pending = forceApproval || needsApproval(db, seniorId, user, price.total, source);
  const b = db.insert('bookings', {
    seniorId, seniorName: senior.name, listingId, serviceId: svc.id, serviceName: svc.name, serviceNameHi: svc.nameHi, checklistKey: svc.checklist,
    providerId: provider.id, providerName: provider.name, caregiverId: cg?.id || null, caregiverName: cg?.name || null,
    start, end: start + dur * MIN, qty: 1, addOns, notes, price, status: pending ? 'pending_approval' : 'requested',
    bookedBy: user.id, bookedByName: user.name, source, recurrenceId, mandateId, visitCode: randomDigits(4),
    timeline: [], alerts: {}, checkInAttempts: 0, isCheckVisit: !!svc.checkVisit, moneyTask: !!svc.moneyTask,
  }, 'bkg');
  tl(b, pending ? `Requested by ${user.name}, waiting for family approval` : `Booked and paid by ${user.name}`, db);
  if (pending) {
    const managers = db.filter('circle', (c) => c.seniorId === seniorId && ['owner', 'manager'].includes(c.role) && c.userId !== user.id && c.status !== 'removed').map((c) => c.userId);
    notify(db, { to: managers, channels: ['push', 'whatsapp'], title: 'Approval needed', body: `${user.name} asked for ${svc.name} for ${senior.name} (Rs ${price.total}). Approve or decline in the app.`, event: 'approval', seniorId });
    activity(db, seniorId, user, `requested ${svc.name} (Rs ${price.total}), waiting for approval`, 'approval');
  } else {
    payAndRequest(db, b, user, { method, useCredit, mandateId });
  }
  audit(db, user, 'booking.create', b.id);
  return b;
}

function payAndRequest(db, b, payer, { method = 'upi', useCredit = false, mandateId = null } = {}) {
  const pay = capture(db, { userId: payer.id, seniorId: b.seniorId, amount: b.price.total, purpose: b.serviceName, method, bookingId: b.id, useCredit, mandateId });
  const far = b.start - db.now() > 48 * HOUR;
  const c = config(db);
  Object.assign(b, { paymentId: pay.id, payerId: payer.id, payerName: payer.name, status: 'requested', requestedAt: db.now(), acceptBy: db.now() + (far ? c.acceptWindowFarMin : c.acceptWindowMin) * MIN });
  const provider = db.get('providers', b.providerId);
  const toProvider = provider.adminUserId ? [provider.adminUserId] : [];
  notify(db, { to: toProvider, channels: ['push', 'sms'], title: 'New booking request', body: `${b.serviceName} for ${b.seniorName} on ${fmt(b.start)}. Please accept within ${far ? '2 hours' : '30 minutes'}.`, event: 'booking_request' });
  activity(db, b.seniorId, payer, `booked ${b.serviceName} with ${b.providerName} for ${fmt(b.start)}`, 'booking');
  db.dirty = true;
}

export function fmt(ts) {
  return new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function getBooking(db, id) {
  const b = db.get('bookings', id);
  assert(b, 404, 'Booking not found');
  return b;
}

function assertProviderSide(db, user, b) {
  if (isStaff(user)) return;
  const admin = providerAdminFor(db, user);
  const cg = caregiverFor(db, user);
  if (admin && admin.id === b.providerId) return;
  if (cg && (cg.id === b.caregiverId || cg.providerId === b.providerId)) return;
  fail(403, 'This booking is not yours');
}

export function assignCaregiver(db, b, cg, by) {
  b.caregiverId = cg.id;
  b.caregiverName = cg.name;
  b.status = 'assigned';
  b.assignedAt = db.now();
  tl(b, `${cg.name} assigned`, db);
  notifyCircle(db, b.seniorId, { channels: ['push'], title: 'Caregiver assigned', body: `${cg.name} (${CAREGIVER_CATEGORIES[cg.category]?.label}) will come for ${b.serviceName} on ${fmt(b.start)}. Visit code: ${b.visitCode}.`, event: 'caregiver_assigned' }, { includeSenior: true });
  if (cg.userId) notify(db, { to: cg.userId, channels: ['push'], title: 'New visit assigned', body: `${b.serviceName} for ${b.seniorName}, ${fmt(b.start)}`, event: 'assigned' });
  db.dirty = true;
}

export function cancelBooking(db, b, by, user, reason) {
  const c = cancellationCharge({ start: b.start, now: db.now(), careValue: b.price.careValue, by });
  const pay = b.paymentId ? db.get('payments', b.paymentId) : null;
  b.status = 'cancelled';
  b.cancelledBy = by;
  b.cancelledAt = db.now();
  b.cancelCharge = c.charge;
  tl(b, `Cancelled by ${by === 'provider' ? 'provider' : user?.name || 'family'}${reason ? ': ' + reason : ''}`, db);
  if (pay) {
    const amount = by === 'provider' ? pay.amount : pay.amount - c.charge - (c.pct === 100 ? b.price.platformFee + b.price.gst : 0);
    refund(db, { payment: pay, amount: Math.max(0, amount), reason: `Cancellation of ${b.serviceName}` });
  }
  if (by === 'provider') {
    if (b.payerId) addCredit(db, b.payerId, c.credit, 'Provider cancelled: goodwill credit');
    // FR-SUB-09 backup guarantee: if subscribed and within 12 h, coordinator finds a replacement
    const sub = db.find('subscriptions', (s) => s.seniorId === b.seniorId && s.status === 'active');
    if (sub && b.start - db.now() < 12 * HOUR) {
      db.insert('qualityTickets', { kind: 'replacement', bookingId: b.id, seniorId: b.seniorId, caregiverId: b.caregiverId, providerId: b.providerId, text: `Late provider cancellation for subscribed senior ${b.seniorName}. Assign a replacement (backup guarantee).`, status: 'open', priority: 'high' }, 'qtk');
    }
    notifyCircle(db, b.seniorId, { channels: ['push', 'sms'], title: 'Visit cancelled by provider', body: `${b.providerName} cancelled ${b.serviceName} on ${fmt(b.start)}. Full refund and Rs ${c.credit} credit added. We can find you someone else.`, event: 'cancelled' });
  } else {
    const provider = db.get('providers', b.providerId);
    notify(db, { to: [provider.adminUserId, db.get('caregivers', b.caregiverId)?.userId].filter(Boolean), channels: ['push'], title: 'Booking cancelled', body: `${b.serviceName} for ${b.seniorName} on ${fmt(b.start)} was cancelled by the family.`, event: 'cancelled' });
  }
  activity(db, b.seniorId, user, `cancelled ${b.serviceName} on ${fmt(b.start)}${c.charge ? ` (charge Rs ${c.charge})` : ''}`);
  db.dirty = true;
  return c;
}

export function routes(r) {
  r('POST', '/bookings/quote', ({ db, body }) => {
    const listing = db.get('listings', body.listingId);
    assert(listing, 404, 'Listing not found');
    return quote(db, { listing, seniorId: body.seniorId, addOnNames: body.addOns || [] });
  });

  r('POST', '/bookings', ({ db, user, body }) => {
    const rec = body.recurrence;
    if (rec && rec.pattern && rec.pattern !== 'once') {
      // FR-BKG-02 recurring bookings, up to 90 days, under one mandate
      const until = Math.min(Number(rec.weeks || 4) * 7, 90);
      const startKey = istDateKey(Number(body.start));
      const hhmm = new Date(Number(body.start) + 330 * MIN).toISOString().slice(11, 16);
      const recurrenceId = db.id('rec');
      const mandateId = 'mdt_' + Math.random().toString(36).slice(2, 10);
      const made = [];
      for (let i = 0; i < until; i++) {
        const key = addDaysKey(startKey, i);
        const dow = weekdayOfKey(key);
        const ok = rec.pattern === 'daily' || (rec.pattern === 'weekdays' && (rec.days || [1, 2, 3, 4, 5]).includes(dow)) || (rec.pattern === 'weekly' && i % 7 === 0);
        if (!ok) continue;
        try {
          made.push(createBooking(db, user, { ...body, start: istTime(key, hhmm), recurrenceId, mandateId, method: 'mandate', skipSlotCheck: i > 0 }));
        } catch (e) { if (i === 0) throw e; }
      }
      return { recurrenceId, count: made.length, first: bookingView(db, made[0], user), mandateId };
    }
    const b = createBooking(db, user, body);
    return bookingView(db, b, user);
  });

  // FR-CON-05: senior asks for help with one tap; the family approves
  r('POST', '/senior/request', ({ db, user, body }) => {
    const senior = db.find('seniors', (s) => s.userId === user.id) || db.get('seniors', body.seniorId);
    assert(senior, 404, 'No senior profile');
    requireSenior(db, user, senior.id);
    const svcId = { nurse: 'svc_nurse_visit', attendant: 'svc_attendant12', escort: 'svc_escort', errand: 'svc_errand', companion: 'svc_companion', physio: 'svc_physio', techhelp: 'svc_techhelp' }[body.kind] || body.serviceId;
    const listings = db.filter('listings', (l) => l.serviceId === svcId && l.status === 'published').map((l) => listingView(db, l, senior))
      .filter((x) => x.provider.status === 'verified' && x.distanceKm <= x.radiusKm && x.nextSlot).sort((a, b) => (b.provider.quality ?? 0) - (a.provider.quality ?? 0));
    if (!listings.length) {
      db.insert('supplyRequests', { seniorId: senior.id, area: senior.area, serviceId: svcId, userId: user.id, status: 'open' }, 'sup');
      notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Senior asked for help', body: `${senior.name} asked for ${svcId}; no provider free`, event: 'supply' });
      return { ok: true, message: 'A coordinator will call you shortly.' };
    }
    const top = listings[0];
    const b = createBooking(db, user, { listingId: top.id, seniorId: senior.id, start: body.start || top.nextSlot, source: 'senior_request', notes: body.note || 'Requested by the senior', forceApproval: true });
    return { ok: true, booking: bookingView(db, b, user), message: 'Your family has been asked to approve.' };
  });

  r('GET', '/bookings', ({ db, user, query }) => {
    let rows;
    if (query.seniorId) { requireSenior(db, user, query.seniorId); rows = db.filter('bookings', (b) => b.seniorId === query.seniorId); }
    else if (user.role === 'caregiver') { const cg = caregiverFor(db, user); rows = db.filter('bookings', (b) => b.caregiverId === cg?.id); }
    else if (user.role === 'provider_admin') { const p = providerAdminFor(db, user); rows = db.filter('bookings', (b) => b.providerId === p?.id); }
    else if (isStaff(user)) rows = db.all('bookings').filter((b) => !b.background);
    else {
      const ids = db.filter('circle', (c) => c.userId === user.id && c.status !== 'removed').map((c) => c.seniorId);
      const own = db.find('seniors', (s) => s.userId === user.id);
      if (own) ids.push(own.id);
      rows = db.filter('bookings', (b) => ids.includes(b.seniorId));
    }
    if (query.status) rows = rows.filter((b) => query.status.split(',').includes(b.status));
    if (query.scope === 'upcoming') rows = rows.filter((b) => OPEN_STATES.includes(b.status)).sort((a, b) => a.start - b.start);
    else if (query.scope === 'past') rows = rows.filter((b) => !OPEN_STATES.includes(b.status)).sort((a, b) => b.start - a.start);
    else rows = rows.sort((a, b) => b.start - a.start);
    return rows.slice(0, Number(query.limit) || 200).map((b) => bookingView(db, b, user));
  });

  r('GET', '/bookings/:id', ({ db, user, params }) => {
    const b = getBooking(db, params.id);
    try { requireSenior(db, user, b.seniorId); } catch { assertProviderSide(db, user, b); }
    const v = bookingView(db, b, user);
    const isProviderSide = user.role === 'caregiver' || user.role === 'provider_admin';
    if (isProviderSide) {
      const cg = caregiverFor(db, user);
      const access = cg && cg.id === b.caregiverId && b.assignedAt && db.now() <= b.end + 24 * HOUR;
      if (access) {
        const s = db.get('seniors', b.seniorId);
        v.careProfile = { name: s.name, lat: s.lat, lng: s.lng, age: Math.floor((db.now() - Date.parse(s.dob)) / (365.25 * DAY)), address: s.address, conditions: s.conditions, allergies: s.allergies, mobility: s.mobility, cognition: s.cognition, emergencyContacts: s.emergencyContacts, medicines: db.filter('medicines', (m) => m.seniorId === s.id && m.active).map((m) => ({ id: m.id, name: m.name, strength: m.strength, dose: m.dose, times: m.times })), carePlan: db.find('carePlans', (p) => p.seniorId === s.id) };
      } else v.careProfileNote = 'The senior\'s care profile is visible from assignment until 24 hours after the visit.';
      v.checklistItems = CHECKLISTS[b.checklistKey] || CHECKLISTS.nursing;
      v.payout = db.find('payouts', (p) => p.bookingId === b.id) || null;
    }
    return v;
  });

  r('POST', '/bookings/:id/approve', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    requireSenior(db, user, b.seniorId, 'manage');
    assert(b.status === 'pending_approval', 400, 'This booking is not waiting for approval');
    tl(b, `Approved by ${user.name}`, db);
    payAndRequest(db, b, user, { method: body.method || 'upi', useCredit: body.useCredit });
    const senior = db.get('seniors', b.seniorId);
    if (senior.userId) notify(db, { to: senior.userId, channels: ['push', 'voice'], title: 'Approved', body: `${user.name} approved ${b.serviceName}.`, event: 'approval' });
    activity(db, b.seniorId, user, `approved ${b.serviceName} (Rs ${b.price.total})`, 'approval');
    return bookingView(db, b, user);
  });
  r('POST', '/bookings/:id/reject', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    requireSenior(db, user, b.seniorId, 'manage');
    assert(b.status === 'pending_approval', 400, 'This booking is not waiting for approval');
    b.status = 'cancelled'; b.cancelledBy = 'family'; b.cancelledAt = db.now();
    tl(b, `Declined by ${user.name}${body.reason ? ': ' + body.reason : ''}`, db);
    activity(db, b.seniorId, user, `declined the request for ${b.serviceName}`, 'approval');
    db.dirty = true;
    return bookingView(db, b, user);
  });

  // FR-BKG-03 / 04
  r('POST', '/bookings/:id/accept', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    assertProviderSide(db, user, b);
    assert(b.status === 'requested', 400, 'This request is no longer open');
    b.status = 'accepted';
    b.acceptedAt = db.now();
    tl(b, `Accepted by ${db.get('providers', b.providerId).name}`, db);
    notifyCircle(db, b.seniorId, { channels: ['push'], title: 'Booking accepted', body: `${b.providerName} accepted ${b.serviceName} on ${fmt(b.start)}.`, event: 'booking_accepted' });
    const provider = db.get('providers', b.providerId);
    if (provider.type === 'independent') assignCaregiver(db, b, db.get('caregivers', b.caregiverId), user);
    else if (body.caregiverId) assignCaregiver(db, b, db.get('caregivers', body.caregiverId), user);
    db.dirty = true;
    return bookingView(db, b, user);
  });
  r('POST', '/bookings/:id/decline', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    assertProviderSide(db, user, b);
    assert(b.status === 'requested', 400, 'This request is no longer open');
    b.status = 'declined';
    tl(b, `Declined by provider${body.reason ? ': ' + body.reason : ''}`, db);
    refund(db, { payment: db.get('payments', b.paymentId), amount: b.price.total, reason: 'Provider declined' });
    notifyCircle(db, b.seniorId, { channels: ['push', 'sms'], title: 'Provider not available', body: `${b.providerName} could not take ${b.serviceName}. Full refund started. Tap to see other providers.`, event: 'booking_declined' });
    db.dirty = true;
    return bookingView(db, b, user);
  });
  r('POST', '/bookings/:id/assign', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    assertProviderSide(db, user, b);
    assert(['accepted', 'assigned'].includes(b.status), 400, 'Accept the booking first');
    const cg = db.get('caregivers', body.caregiverId);
    assert(cg && (cg.providerId === b.providerId || isStaff(user)) && cg.status === 'verified', 400, 'Only verified staff can be assigned');
    const svc = serviceById(db, b.serviceId);
    assert(svc.allowed.includes(cg.category), 400, `${CAREGIVER_CATEGORIES[cg.category].label} cannot deliver ${svc.name}`);
    assignCaregiver(db, b, cg, user);
    return bookingView(db, b, user);
  });

  // FR-BKG-06: GPS within 150 m plus the senior's 4-digit visit code
  r('POST', '/bookings/:id/checkin', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    const cg = caregiverFor(db, user);
    assert(cg && cg.id === b.caregiverId, 403, 'Only the assigned caregiver can check in');
    assert(b.status === 'assigned', 400, 'This visit is not ready for check-in');
    assert(db.now() >= b.start - 60 * MIN, 400, 'Check-in opens one hour before the visit');
    const senior = db.get('seniors', b.seniorId);
    const distM = Math.round(haversineKm(senior, { lat: Number(body.lat), lng: Number(body.lng) }) * 1000);
    if (distM > config(db).checkInRadiusM) {
      b.checkInAttempts = (b.checkInAttempts || 0) + 1;
      tl(b, `Check-in refused: ${distM} m from the home`, db);
      if (b.checkInAttempts >= 3) notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Repeated check-in failure', body: `${cg.name} tried to check in ${distM} m away from ${b.seniorName}'s home (3 attempts).`, event: 'checkin_fail' });
      db.dirty = true;
      fail(400, `You are ${distM} m from the senior's home. Check-in works within ${config(db).checkInRadiusM} m.`, 'distance');
    }
    assert(String(body.code) === b.visitCode, 400, 'The visit code is not right. Ask the senior for the 4-digit code on their phone.', 'code');
    Object.assign(b, { status: 'in_progress', checkInAt: db.now(), checkInDistanceM: distM, checkInGeo: { lat: Number(body.lat), lng: Number(body.lng) } });
    tl(b, `Checked in (${distM} m, code verified)`, db);
    notifyCircle(db, b.seniorId, { channels: ['push'], title: 'Caregiver arrived', body: `${cg.name} checked in at ${b.seniorName}'s home.`, event: 'check_in' });
    db.dirty = true;
    return bookingView(db, b, user);
  });

  // FR-BKG-07 / 08, FR-CHK-03..05, FR-MED-07
  r('POST', '/bookings/:id/checkout', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    const cg = caregiverFor(db, user);
    assert(cg && cg.id === b.caregiverId, 403, 'Only the assigned caregiver can check out');
    assert(b.status === 'in_progress', 400, 'Check in first');
    const items = CHECKLISTS[b.checklistKey] || CHECKLISTS.nursing;
    const checklist = body.checklist || {};
    const doneCount = items.filter((i) => checklist[i]).length;
    assert(doneCount >= Math.ceil(items.length / 2), 400, 'Please complete the checklist before checking out');
    const senior = db.get('seniors', b.seniorId);
    const distM = Math.round(haversineKm(senior, { lat: Number(body.lat ?? senior.lat), lng: Number(body.lng ?? senior.lng) }) * 1000);
    let vitalsRec = null;
    let status = null;
    const v = body.vitals || {};
    const clean = {};
    for (const k of ['bpSys', 'bpDia', 'pulse', 'spo2', 'temp', 'sugar', 'weight']) if (v[k] !== undefined && v[k] !== '' && v[k] !== null) clean[k] = Number(v[k]);
    if (Object.keys(clean).length) {
      vitalsRec = db.insert('vitals', { seniorId: b.seniorId, at: db.now(), source: b.isCheckVisit ? 'check visit' : 'visit', bookingId: b.id, by: cg.name, ...clean }, 'vit');
      status = vitalsStatus(clean, config(db).vitalThresholds);
      if (status.overall === 'red' || (b.isCheckVisit && status.overall === 'amber')) {
        notifyCircle(db, b.seniorId, { channels: ['push', 'sms', ...(status.overall === 'red' ? ['voice'] : [])], title: status.overall === 'red' ? 'Abnormal vitals' : 'Vitals need attention', body: `${b.seniorName}: BP ${clean.bpSys ?? '-'}/${clean.bpDia ?? '-'}, SpO2 ${clean.spo2 ?? '-'}%, sugar ${clean.sugar ?? '-'}. ${nextStepFor(status.overall)}`, event: 'abnormal_vitals', critical: status.overall === 'red' });
        notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Abnormal vitals', body: `${b.seniorName}: ${status.overall.toUpperCase()}`, event: 'abnormal_vitals' });
      }
    }
    // FR-MED-07: doses given by the caregiver count as Taken
    for (const medId of body.medsGiven || []) {
      const dose = db.filter('doses', (d) => d.medicineId === medId && ['due', 'reminded', 'later', 'missed'].includes(d.status)).sort((a, c) => Math.abs(a.due - db.now()) - Math.abs(c.due - db.now()))[0];
      if (dose && Math.abs(dose.due - db.now()) < 4 * HOUR) Object.assign(dose, { status: 'taken', takenAt: db.now(), source: `caregiver ${cg.name}` });
    }
    const traffic = b.isCheckVisit ? checkVisitTraffic(body, status) : null;
    const report = db.insert('visitReports', { bookingId: b.id, seniorId: b.seniorId, checklist, checklistItems: items, vitalsId: vitalsRec?.id, vitals: clean, vitalsStatus: status, medsGiven: body.medsGiven || [], observations: body.observations || '', mood: body.mood, traffic, by: cg.name }, 'vrp');
    Object.assign(b, { status: 'completed', checkOutAt: db.now(), checkOutDistanceM: distM, completedAt: db.now(), checklistRate: doneCount / items.length, reportId: report.id });
    tl(b, 'Checked out, visit report sent to family', db);
    notifyCircle(db, b.seniorId, { channels: ['push', 'whatsapp'], title: 'Visit report ready', body: `${cg.name} finished ${b.serviceName} for ${b.seniorName}. ${status ? 'Vitals: ' + status.overall + '.' : ''} Tap to confirm or raise an issue within 24 hours.`, event: 'check_out' });
    if (senior.userId) notify(db, { to: senior.userId, channels: ['push', 'voice'], title: 'How was the visit?', body: `Please rate ${cg.name}'s visit.`, event: 'review_request' });
    activity(db, b.seniorId, null, `${cg.name} completed ${b.serviceName}`, 'visit');
    db.dirty = true;
    return bookingView(db, b, user);
  });

  // FR-BKG-10
  r('POST', '/bookings/:id/confirm', ({ db, user, params }) => {
    const b = getBooking(db, params.id);
    const { role } = requireSenior(db, user, b.seniorId);
    assert(['owner', 'manager', 'self'].includes(role), 403, 'Only the senior, Owner or Manager can confirm');
    assert(b.status === 'completed', 400, 'Only a completed visit can be confirmed');
    confirmBooking(db, b, user.name);
    activity(db, b.seniorId, user, `confirmed the ${b.serviceName} visit`);
    return bookingView(db, b, user);
  });
  r('POST', '/bookings/:id/issue', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    requireSenior(db, user, b.seniorId);
    assert(['completed', 'no_show', 'confirmed', 'assigned', 'in_progress'].includes(b.status), 400, 'Nothing to report on this booking yet');
    const category = body.category || 'Quality of care';
    const p0 = category === 'Safety / abuse';
    if (['completed', 'confirmed'].includes(b.status)) { b.prevStatus = b.status; b.status = 'disputed'; }
    const g = db.insert('grievances', {
      userId: user.id, userName: user.name, seniorId: b.seniorId, bookingId: b.id, providerId: b.providerId, caregiverId: b.caregiverId,
      category, subject: `${category}: ${b.serviceName}`, text: body.text || '', priority: p0 ? 'P0' : 'normal', status: 'open',
      ackDueAt: db.now() + (p0 ? 1 : 48) * HOUR, resolveDueAt: db.now() + (p0 ? 24 : 30 * 24) * HOUR,
    }, 'grv');
    const po = db.find('payouts', (x) => x.bookingId === b.id && x.status === 'scheduled');
    if (po && b.status === 'disputed') po.status = 'held'; // FR-PAY-06
    tl(b, `Issue raised: ${category}. Payout on hold.`, db);
    notifyStaff(db, 'coordinator', { channels: ['push', ...(p0 ? ['sms'] : [])], title: p0 ? 'P0 safety complaint' : 'Booking disputed', body: `${b.seniorName}: ${category}`, event: 'grievance', critical: p0 });
    db.dirty = true;
    return { booking: bookingView(db, b, user), grievance: g };
  });

  r('POST', '/bookings/:id/cancel', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    let by = 'family';
    try { requireSenior(db, user, b.seniorId, 'manage'); } catch { assertProviderSide(db, user, b); by = 'provider'; }
    if (user.role === 'caregiver' || user.role === 'provider_admin') by = 'provider';
    assert(OPEN_STATES.includes(b.status) && b.status !== 'in_progress', 400, 'This booking cannot be cancelled now');
    if (b.status === 'pending_approval') { b.status = 'cancelled'; db.dirty = true; return { booking: bookingView(db, b, user), charge: 0 }; }
    const c = cancelBooking(db, b, by, user, body.reason);
    return { booking: bookingView(db, b, user), charge: c.charge, pct: c.pct };
  });
  r('GET', '/bookings/:id/cancel-preview', ({ db, params }) => {
    const b = getBooking(db, params.id);
    return cancellationCharge({ start: b.start, now: db.now(), careValue: b.price.careValue, by: 'family' });
  });

  // FR-BKG-12
  r('POST', '/bookings/:id/reschedule', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    requireSenior(db, user, b.seniorId, 'manage');
    assert(['requested', 'accepted', 'assigned'].includes(b.status), 400, 'This booking cannot be moved');
    assert(b.start - db.now() >= 12 * HOUR, 400, 'Rescheduling is free up to 12 hours before. Please cancel instead.');
    const listing = db.get('listings', b.listingId);
    const start = Number(body.start);
    const slot = slotsFor(db, listing, istDateKey(start)).find((s) => s.start === start);
    assert(slot && slot.free, 409, 'That slot is not free');
    const old = b.start;
    b.start = start; b.end = start + (b.end - old);
    tl(b, `Moved from ${fmt(old)} to ${fmt(start)} by ${user.name}`, db);
    notify(db, { to: [db.get('providers', b.providerId).adminUserId, db.get('caregivers', b.caregiverId)?.userId].filter(Boolean), channels: ['push'], title: 'Booking rescheduled', body: `${b.serviceName} for ${b.seniorName} moved to ${fmt(start)}`, event: 'rescheduled' });
    activity(db, b.seniorId, user, `moved ${b.serviceName} to ${fmt(start)}`);
    db.dirty = true;
    return bookingView(db, b, user);
  });

  // FR-BKG-13 masked calling (mocked)
  r('POST', '/bookings/:id/call', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    const target = body.to || 'caregiver';
    const cg = b.caregiverId ? db.get('caregivers', b.caregiverId) : null;
    const senior = db.get('seniors', b.seniorId);
    const toName = target === 'senior' ? senior.name : cg?.name || b.providerName;
    notify(db, { to: target === 'senior' ? senior.userId : cg?.userId, toName, channels: ['voice'], title: 'Masked call', body: `${user.name} is calling you through ElderLink. Numbers stay private.`, event: 'masked_call' });
    return { ok: true, message: `Connecting you to ${toName} through a masked number. Neither side sees the other's phone number.` };
  });

  // FR-REV-01..08
  r('POST', '/bookings/:id/review', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    const can = canReview(db, b, user);
    assert(can.ok, 400, can.reason || 'You cannot review this visit');
    const ratings = {};
    for (const d of RATING_DIMENSIONS) if (body.ratings?.[d]) ratings[d] = Math.min(5, Math.max(1, Number(body.ratings[d])));
    if (!Object.keys(ratings).length && body.overall) ratings.overall = Math.min(5, Math.max(1, Number(body.overall)));
    assert(Object.keys(ratings).length, 400, 'Please give at least one star rating');
    const score = reviewScore(ratings);
    const providerTexts = db.filter('reviews', (x) => x.providerId === b.providerId).map((x) => x.text);
    const recentFive = db.filter('reviews', (x) => x.providerId === b.providerId && x.createdAt > db.now() - DAY && reviewScore(x.ratings) >= 4.8).length;
    const flags = reviewFraudFlags({ text: body.text, existingTexts: providerTexts, recentFiveStarCount: recentFive });
    const circle = db.find('circle', (c) => c.seniorId === b.seniorId && c.userId === user.id);
    const label = can.type === 'senior' ? 'Senior' : `Paid by ${circle?.relation || 'family'}`;
    const rv = db.insert('reviews', {
      bookingId: b.id, providerId: b.providerId, caregiverId: b.caregiverId, seniorId: b.seniorId, userId: user.id, reviewerType: can.type, reviewerLabel: label,
      ratings, text: String(body.text || '').slice(0, 1000), tags: body.tags || [], visitDate: b.start, serviceName: b.serviceName,
      status: flags.length ? 'held' : 'published', flags, channel: body.channel || 'app',
    }, 'rev');
    const bad = score <= 2 || (body.tags || []).some((t) => ['rude', 'unsafe', 'did not come'].includes(t));
    if (bad) {
      db.insert('qualityTickets', { kind: 'low_rating', bookingId: b.id, reviewId: rv.id, seniorId: b.seniorId, caregiverId: b.caregiverId, providerId: b.providerId, text: `${label} rated ${score} stars${body.tags?.length ? ' (' + body.tags.join(', ') + ')' : ''}: ${body.text || ''}`, status: 'open', priority: 'high', dueAt: db.now() + HOUR }, 'qtk');
      notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Low rating', body: `${b.caregiverName || b.providerName}: ${score} stars from ${label}`, event: 'quality_ticket' });
    }
    if (flags.length) notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Review held for moderation', body: `${b.providerName}: ${flags.join(', ')}`, event: 'review_held' });
    if (b.status === 'completed' && can.type) confirmBooking(db, b, user.name);
    activity(db, b.seniorId, user, `rated ${b.caregiverName || b.providerName} ${score} stars`);
    return { review: rv, held: !!flags.length };
  });

  r('POST', '/reviews/:id/reply', ({ db, user, params, body }) => {
    const rv = db.get('reviews', params.id);
    assert(rv, 404, 'Review not found');
    const p = providerAdminFor(db, user) || db.get('providers', caregiverFor(db, user)?.providerId);
    assert(p && p.id === rv.providerId, 403, 'Not your review');
    assert(!rv.reply, 400, 'You can reply once per review');
    assert(body.text?.trim(), 400, 'Write a reply');
    db.update('reviews', rv.id, { reply: { text: body.text.trim().slice(0, 500), at: db.now(), by: p.name } });
    return db.get('reviews', rv.id);
  });

  // FR-REV-11 caregiver rates the household
  r('POST', '/bookings/:id/household', ({ db, user, params, body }) => {
    const b = getBooking(db, params.id);
    const cg = caregiverFor(db, user);
    assert(cg && cg.id === b.caregiverId, 403, 'Only the caregiver who visited can rate');
    const f = db.insert('householdFlags', { bookingId: b.id, seniorId: b.seniorId, caregiverId: cg.id, rating: Number(body.rating) || null, flag: body.flag || null, text: body.text || '' }, 'hhf');
    if (body.flag) notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Caregiver safety flag', body: `${cg.name} flagged ${b.seniorName}'s household: ${body.flag}`, event: 'household_flag' });
    return f;
  });
}

function checkVisitTraffic(body, status) {
  const c = body.checklist || {};
  const area = (ok, warn) => (ok ? 'green' : warn ? 'amber' : 'red');
  return {
    vitals: status?.overall || 'green',
    medicines: body.medStock === 'low' ? 'amber' : 'green',
    home: c['Home fall-risk check'] ? (body.fallRisk === 'high' ? 'red' : body.fallRisk === 'some' ? 'amber' : 'green') : 'amber',
    mood: body.mood === 'low' ? 'amber' : body.mood === 'very low' ? 'red' : 'green',
    nutrition: area(c['Nutrition and hydration'], true),
  };
}

export function confirmBooking(db, b, by) {
  if (b.status !== 'completed') return;
  b.status = 'confirmed';
  b.confirmedAt = db.now();
  (b.timeline ||= []).push({ at: db.now(), text: `Confirmed${by ? ' by ' + by : ' automatically after 24 hours'}; payment released from escrow` });
  release(db, b);
  db.dirty = true;
}

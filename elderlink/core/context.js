// Shared helpers used by every module: access checks, notifications, audit, activity,
// and the read models (provider cards, quality score) that several screens need.
import { CONFIG, SERVICES, CAREGIVER_CATEGORIES } from './catalog.js';
import { qualityBand, qualityScore, reviewScore, visitRating } from './rules.js';
import { DAY, HOUR, assert, fail, istMinutes, avg } from './util.js';

export const STAFF_ROLES = ['coordinator', 'emergency', 'admin'];

export function config(db) {
  return db.data.meta.config || CONFIG;
}

export function isStaff(user) {
  return user && STAFF_ROLES.includes(user.role);
}

export function requireRole(user, ...roles) {
  assert(user, 401, 'Please sign in');
  if (!roles.includes(user.role)) fail(403, 'You do not have access to this');
}

/** Care-circle role for a user on a senior, or 'self' for the senior, 'staff' for ops. */
export function circleRole(db, user, seniorId) {
  if (!user) return null;
  const senior = db.get('seniors', seniorId);
  if (!senior) return null;
  if (senior.userId === user.id) return 'self';
  if (isStaff(user)) return 'staff';
  const m = db.find('circle', (c) => c.seniorId === seniorId && c.userId === user.id && c.status !== 'removed');
  return m ? m.role : null;
}

export function requireSenior(db, user, seniorId, need = 'view') {
  const senior = db.get('seniors', seniorId);
  assert(senior, 404, 'Senior not found');
  const role = circleRole(db, user, seniorId);
  if (!role) {
    // a caregiver may see the care-relevant profile during an active booking (FR-BKG-05)
    if (user && user.role === 'caregiver' && need === 'view' && caregiverHasAccess(db, user, seniorId)) return { senior, role: 'caregiver' };
    fail(403, 'You are not in this care circle');
  }
  if (need === 'manage' && !['owner', 'manager', 'self', 'staff'].includes(role)) fail(403, 'Only an Owner or Manager can do this');
  if (need === 'owner' && !['owner', 'staff'].includes(role)) fail(403, 'Only the care circle Owner can do this');
  return { senior, role };
}

export function caregiverFor(db, user) {
  return user ? db.find('caregivers', (c) => c.userId === user.id) : null;
}

export function caregiverHasAccess(db, user, seniorId) {
  const cg = caregiverFor(db, user);
  if (!cg) return false;
  const now = db.now();
  return db.filter('bookings', (b) => b.seniorId === seniorId && b.caregiverId === cg.id).some((b) =>
    ['assigned', 'in_progress', 'completed', 'confirmed', 'paid_out'].includes(b.status) &&
    (b.assignedAt || 0) <= now && now <= b.end + 24 * HOUR);
}

export function providerAdminFor(db, user) {
  return user ? db.find('providers', (p) => p.adminUserId === user.id) : null;
}

export function circleMembers(db, seniorId) {
  return db.filter('circle', (c) => c.seniorId === seniorId && c.status !== 'removed').map((c) => ({ ...c, user: db.get('users', c.userId) }));
}

/** Everyone who should hear about a senior: circle members, plus the senior themself. */
export function audienceFor(db, seniorId, { includeSenior = false } = {}) {
  const ids = circleMembers(db, seniorId).map((m) => m.userId);
  const s = db.get('seniors', seniorId);
  if (includeSenior && s?.userId) ids.push(s.userId);
  return [...new Set(ids)];
}

/**
 * Record an outbound message. Channels other than in-app push are mocked (SMS, WhatsApp,
 * voice), but every message is stored so the demo "Phone messages" panel can show it.
 */
export function notify(db, { to, toName, toPhone, channels = ['push'], title, body, event, seniorId, critical = false, link }) {
  const recipients = Array.isArray(to) ? to : to ? [to] : [null];
  const out = [];
  for (const uid of recipients) {
    const user = uid ? db.get('users', uid) : null;
    let quiet = false;
    if (user?.prefs?.quietHours && !critical) {
      const [from, until] = user.prefs.quietHours;
      const m = istMinutes(db.now());
      const f = toMin(from), u = toMin(until);
      quiet = f > u ? m >= f || m < u : m >= f && m < u;
    }
    const userChannels = user?.prefs?.channels?.[event];
    const chans = critical ? channels : userChannels ? channels.filter((c) => userChannels.includes(c) || c === 'push') : channels;
    for (const channel of chans) {
      out.push(db.insert('notifications', {
        userId: uid, toName: toName || user?.name, toPhone: toPhone || user?.mobile, channel, title, body, event,
        seniorId, critical, link, status: quiet ? 'held' : 'sent', read: false,
      }, 'ntf'));
    }
  }
  return out;
}
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

export function notifyCircle(db, seniorId, msg, opts = {}) {
  return notify(db, { ...msg, to: audienceFor(db, seniorId, opts), seniorId });
}

export function notifyStaff(db, role, msg) {
  const ids = db.filter('users', (u) => u.role === role).map((u) => u.id);
  return notify(db, { ...msg, to: ids });
}

export function audit(db, user, action, target, details) {
  db.insert('audit', { userId: user?.id || 'system', userName: user?.name || 'System', action, target, details }, 'aud');
}

export function activity(db, seniorId, user, text, kind = 'info') {
  db.insert('activity', { seniorId, userId: user?.id || null, who: user?.name || 'ElderLink', text, kind }, 'act');
}

export function serviceById(db, id) {
  return db.get('services', id) || SERVICES.find((s) => s.id === id);
}

/** SRS 8.1 quality score for one caregiver, computed from the last 90 days. */
export function caregiverQuality(db, caregiverId) {
  const now = db.now();
  const since = now - 90 * DAY;
  const bookings = db.filter('bookings', (b) => b.caregiverId === caregiverId && b.start >= since && b.start <= now);
  const done = bookings.filter((b) => ['completed', 'confirmed', 'paid_out', 'disputed'].includes(b.status));
  const noShows = bookings.filter((b) => b.status === 'no_show').length;
  const providerCancels = bookings.filter((b) => b.status === 'cancelled' && b.cancelledBy === 'provider').length;
  const visits = done.length + noShows;
  const ratings = done.map((b) => bookingRating(db, b.id)).filter((r) => r != null);
  const onTime = done.filter((b) => b.checkInAt && b.checkInAt - b.start <= 10 * 60 * 1000).length;
  const checklistRates = done.map((b) => b.checklistRate ?? 1);
  const seniors = {};
  for (const b of done) seniors[b.seniorId] = (seniors[b.seniorId] || 0) + 1;
  const seniorCount = Object.keys(seniors).length;
  const repeat = seniorCount ? Object.values(seniors).filter((n) => n > 1).length / seniorCount : 0;
  const complaints = db.filter('grievances', (g) => g.caregiverId === caregiverId && g.substantiated).length + providerCancels;
  const parts = {
    avgRating: avg(ratings), onTimeRate: visits ? onTime / visits : null, checklistRate: avg(checklistRates),
    repeatRate: repeat, complaints, visits,
  };
  const score = qualityScore(parts, config(db).qualityWeights);
  return { score, band: qualityBand(score), parts, reviewCount: ratings.length };
}

export function bookingRating(db, bookingId) {
  const revs = db.filter('reviews', (r) => r.bookingId === bookingId && r.status === 'published');
  const s = revs.find((r) => r.reviewerType === 'senior');
  const p = revs.find((r) => r.reviewerType === 'payer');
  return visitRating(s ? reviewScore(s.ratings) : null, p ? reviewScore(p.ratings) : null);
}

export function providerQuality(db, providerId) {
  const provider = db.get('providers', providerId);
  if (provider?.type === 'independent') {
    const cg = db.find('caregivers', (c) => c.providerId === providerId);
    return cg ? caregiverQuality(db, cg.id) : { score: null, band: qualityBand(null), parts: {}, reviewCount: 0 };
  }
  const staff = db.filter('caregivers', (c) => c.providerId === providerId);
  const qs = staff.map((c) => caregiverQuality(db, c.id)).filter((q) => q.score != null);
  const totalVisits = qs.reduce((s, q) => s + q.parts.visits, 0);
  const score = totalVisits ? Math.round(qs.reduce((s, q) => s + q.score * q.parts.visits, 0) / totalVisits) : null;
  return { score, band: qualityBand(score), parts: { visits: totalVisits }, reviewCount: qs.reduce((s, q) => s + q.reviewCount, 0) };
}

export function badgesFor(db, caregiver) {
  const v = caregiver.verification || {};
  const b = [];
  if (v.id === 'pass') b.push('ID verified');
  if (CAREGIVER_CATEGORIES[caregiver.category]?.nurse || ['PHYSIO', 'DOCTOR'].includes(caregiver.category)) {
    if (v.registration === 'pass') b.push('Registration verified');
  }
  if (v.police === 'pass') b.push('Police verified');
  if (caregiver.inductionScore >= 80) b.push('Trained');
  for (const x of caregiver.skillBadges || []) b.push(x);
  return b;
}

export function isTrusted(db, providerId) {
  const q = providerQuality(db, providerId);
  return q.score != null && q.score >= 90;
}

/** Public card of a provider used by search, profile and booking screens. */
export function providerCard(db, provider) {
  const quality = providerQuality(db, provider.id);
  const staff = db.filter('caregivers', (c) => c.providerId === provider.id);
  const lead = provider.type === 'independent' ? staff[0] : null;
  const badges = lead ? badgesFor(db, lead) : provider.verification?.facility === 'pass' ? ['Facility licence verified', 'Staff police verified'] : [];
  return {
    id: provider.id, name: provider.name, type: provider.type, city: provider.city, area: provider.area,
    photo: provider.photo || lead?.photo, bio: provider.bio, languages: provider.languages || lead?.languages || [],
    gender: lead?.gender, category: lead?.category, categoryLabel: lead ? CAREGIVER_CATEGORIES[lead.category]?.label : provider.typeLabel,
    qualifications: lead?.qualifications || provider.qualifications, experienceYears: lead?.experienceYears || provider.experienceYears,
    registration: lead?.registrationNo ? `${lead.registrationCouncil} ${lead.registrationNo}` : provider.registrationNo,
    address: provider.address, status: provider.status, badges, lastChecked: provider.lastChecked || lead?.lastChecked,
    quality: quality.score, band: quality.band, reviewCount: quality.reviewCount, trusted: quality.score != null && quality.score >= 90,
    staffCount: provider.type === 'independent' ? 1 : staff.length,
  };
}

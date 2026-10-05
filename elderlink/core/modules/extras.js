// Extended modules (FRS section 11): health helpline (HLT), care programs (PRG), equipment (EQP),
// safety plus (SAF), scam shield (SCM), social (SOC), entitlements and vault (ENT),
// caregiver academy (PGT), referral (PTN-05).
import { assert, ageFromDob, DAY, HOUR, MIN, istDateKey } from '../util.js';
import { activity, caregiverFor, notify, notifyCircle, notifyStaff, requireRole, requireSenior, circleMembers } from '../context.js';
import { SCHEMES } from '../catalog.js';
import { capture, refund, addCredit } from '../payments.js';
import { raiseSos } from './emergency.js';

export const PROGRAMS = [
  { id: 'prg_posthosp', name: '30-day post-hospital transition', price: 14999, days: 30, includes: ['8 nursing visits', '4 physiotherapy sessions', 'Weekly doctor review', 'Equipment advice'], goal: 'No readmission in 30 days' },
  { id: 'prg_knee', name: 'Knee / hip replacement rehab', price: 18999, days: 42, includes: ['18 physiotherapy sessions', 'Walker on rent', 'Weekly progress report'], goal: 'Walk 100 m unaided' },
  { id: 'prg_diabetes', name: 'Diabetes control (3 months)', price: 5999, days: 90, includes: ['Fortnightly sugar check', 'Diet plan', 'Monthly doctor teleconsult', 'HbA1c test at day 0 and 90'], goal: 'HbA1c under 7.5%' },
  { id: 'prg_bp', name: 'Blood pressure control (3 months)', price: 3999, days: 90, includes: ['Weekly BP check', 'Medicine adherence coaching', 'Monthly doctor review'], goal: 'BP under 140/90' },
  { id: 'prg_dementia', name: 'Dementia care (monthly)', price: 11999, days: 30, includes: ['Daily attendant 6 hours', 'Weekly nurse visit', 'Family counselling session', 'Wander geofence set-up'], goal: 'Safe at home, carer rested' },
  { id: 'prg_palliative', name: 'Palliative care (monthly)', price: 15999, days: 30, includes: ['3 nurse visits a week', 'Doctor visit fortnightly', '24x7 nurse helpline priority'], goal: 'Comfort and dignity at home' },
];

export function routes(r) {
  // ---- FR-HLT-01/02 nurse helpline ----
  r('POST', '/helpline', ({ db, user, body }) => {
    const senior = body.seniorId ? db.get('seniors', body.seniorId) : db.find('seniors', (s) => s.userId === user.id);
    assert(senior, 404, 'Senior not found');
    requireSenior(db, user, senior.id);
    const red = /chest|breath|unconscious|stroke|faint|bleed|seizure|सीने|साँस/i.test(body.question || '');
    const call = db.insert('helplineCalls', { seniorId: senior.id, userId: user.id, question: body.question || 'Call back requested', nurse: 'Nurse Shalini (RN, helpline)', status: red ? 'escalated' : 'answered', answeredInSec: 70, advice: red ? 'Red-flag symptom reported: moved to emergency desk.' : 'Nurse will call back within 2 minutes. Advice will be logged here.' }, 'hlp');
    notify(db, { to: user.id, channels: ['voice'], title: 'Nurse helpline', body: `Nurse Shalini is calling about ${senior.name}.`, event: 'helpline', seniorId: senior.id });
    let sos = null;
    if (red) sos = raiseSos(db, { senior, trigger: 'nurse helpline escalation', by: user });
    activity(db, senior.id, user, 'called the 24x7 nurse helpline');
    return { call, sos, message: red ? 'This sounds urgent. We have alerted the emergency desk and your family.' : 'A registered nurse will call you within 2 minutes.' };
  });

  // ---- FR-PRG care programs ----
  r('GET', '/programs', () => PROGRAMS, { public: true });
  r('POST', '/programs/:id/enrol', ({ db, user, params, body }) => {
    const prg = PROGRAMS.find((p) => p.id === params.id);
    assert(prg, 404, 'Program not found');
    const { senior } = requireSenior(db, user, body.seniorId, 'manage');
    const pay = capture(db, { userId: user.id, seniorId: senior.id, amount: prg.price, purpose: prg.name, method: body.method || 'upi' });
    const cc = db.find('users', (u) => u.role === 'coordinator');
    const e = db.insert('entitlementApps', { kind: 'program', seniorId: senior.id, programId: prg.id, name: prg.name, status: 'active', ownerCc: cc?.name, startsAt: db.now(), endsAt: db.now() + prg.days * DAY, paymentId: pay.id, progress: [] }, 'prg');
    notifyStaff(db, 'coordinator', { channels: ['push'], title: 'New program enrolment', body: `${senior.name}: ${prg.name}. Match providers and set the schedule.`, event: 'program' });
    activity(db, senior.id, user, `enrolled in ${prg.name}`);
    return { enrolment: e, message: `Enrolled. ${cc?.name || 'Your coordinator'} will call within 2 working hours to set up the schedule.` };
  });

  // ---- FR-EQP equipment ----
  r('GET', '/equipment', ({ db }) => db.all('equipment'), { public: true });
  r('POST', '/equipment/orders', ({ db, user, body }) => {
    const item = db.get('equipment', body.itemId);
    assert(item, 404, 'Item not found');
    const { senior } = requireSenior(db, user, body.seniorId, 'manage');
    const mode = body.mode === 'buy' || !item.rentMonthly ? 'buy' : 'rent';
    const months = Math.max(1, Number(body.months) || 1);
    const amount = mode === 'rent' ? item.rentMonthly * months + item.deposit : item.price;
    const pay = capture(db, { userId: user.id, seniorId: senior.id, amount, purpose: `${item.name} (${mode})`, method: body.method || 'upi' });
    const o = db.insert('equipmentOrders', { itemId: item.id, name: item.name, seniorId: senior.id, userId: user.id, mode, months, deposit: mode === 'rent' ? item.deposit : 0, amount, paymentId: pay.id, slot: body.slot || db.now() + DAY, status: 'scheduled', setupDemo: true, endsAt: mode === 'rent' ? db.now() + months * 30 * DAY : null, partner: item.partner }, 'eqo');
    activity(db, senior.id, user, `ordered ${item.name} (${mode})`);
    return o;
  });
  r('GET', '/equipment/orders', ({ db, user, query }) => {
    requireSenior(db, user, query.seniorId);
    return db.filter('equipmentOrders', (o) => o.seniorId === query.seniorId).sort((a, b) => b.createdAt - a.createdAt);
  });
  r('POST', '/equipment/orders/:id/:action', ({ db, user, params }) => {
    const o = db.get('equipmentOrders', params.id);
    assert(o, 404, 'Order not found');
    requireSenior(db, user, o.seniorId, 'manage');
    const item = db.get('equipment', o.itemId);
    if (params.action === 'extend') {
      capture(db, { userId: user.id, seniorId: o.seniorId, amount: item.rentMonthly, purpose: `${item.name}: one more month`, method: 'upi' });
      o.endsAt += 30 * DAY; o.months += 1;
    } else if (params.action === 'return') {
      o.status = 'return_scheduled';
      refund(db, { payment: db.get('payments', o.paymentId), amount: o.deposit, reason: 'Deposit refund after pickup' });
    } else if (params.action === 'fault') {
      const hrs = item.category === 'oxygen' ? 4 : 24;
      o.fault = { at: db.now(), dueBy: db.now() + hrs * HOUR, status: 'replacement_dispatched' };
      notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Equipment fault', body: `${item.name} faulty at ${db.get('seniors', o.seniorId).name}'s home. Replace within ${hrs} h.`, event: 'equipment_fault', critical: item.category === 'oxygen' });
    } else if (params.action === 'delivered') o.status = 'active';
    db.dirty = true;
    return o;
  });

  // ---- FR-SAF-01/02 daily "Are you OK?" check-in ----
  r('PUT', '/seniors/:id/checkin-settings', ({ db, user, params, body }) => {
    const { senior } = requireSenior(db, user, params.id, 'manage');
    senior.checkinSettings = { enabled: !!body.enabled, time: /^\d\d:\d\d$/.test(body.time) ? body.time : '09:00', human: !!body.human };
    activity(db, senior.id, user, body.enabled ? `set daily check-in at ${senior.checkinSettings.time}` : 'turned off daily check-in');
    db.dirty = true;
    return senior.checkinSettings;
  });
  r('POST', '/seniors/:id/imok', ({ db, user, params, body }) => {
    const { senior } = requireSenior(db, user, params.id);
    const key = istDateKey(db.now());
    let ci = db.find('checkins', (c) => c.seniorId === senior.id && c.date === key);
    if (!ci) ci = db.insert('checkins', { seniorId: senior.id, date: key, attempts: 0, status: 'pending' }, 'chk');
    Object.assign(ci, { status: body.ok === false ? 'needs_help' : 'ok', respondedAt: db.now(), mood: body.mood || null });
    if (body.ok === false) {
      notifyCircle(db, senior.id, { channels: ['push', 'sms'], title: `${senior.name} needs help`, body: `${senior.name} answered "I need help" at the daily check-in. The coordinator is calling now.`, event: 'checkin' });
      notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Senior needs help', body: senior.name, event: 'checkin' });
    }
    db.dirty = true;
    return ci;
  });
  r('GET', '/seniors/:id/checkins', ({ db, user, params }) => {
    requireSenior(db, user, params.id);
    return db.filter('checkins', (c) => c.seniorId === params.id).slice(-30).reverse();
  });

  // ---- FR-SCM scam shield ----
  r('GET', '/scam/alerts', ({ db }) => db.all('scamAlerts'), { public: true });
  r('POST', '/scam/verify', ({ db, user, body }) => {
    const senior = body.seniorId ? db.get('seniors', body.seniorId) : db.find('seniors', (s) => s.userId === user.id);
    assert(senior, 404, 'Senior not found');
    requireSenior(db, user, senior.id);
    const members = circleMembers(db, senior.id);
    const nominee = members.find((m) => m.userId === senior.nominee) || members.find((m) => m.role === 'owner');
    notify(db, { to: nominee?.userId, channels: ['voice', 'push'], title: 'Verify before you pay', body: `${senior.name} wants to check a call or payment before paying. Please call now.`, event: 'scam_verify', critical: true, seniorId: senior.id });
    const rep = db.insert('scamReports', { seniorId: senior.id, channel: 'verify', text: body.text || 'Verify-before-you-pay request', status: 'calling family', nominee: nominee?.user?.name, escalateAt: db.now() + 2 * MIN }, 'scm');
    return { report: rep, message: `Calling ${nominee?.user?.name || 'your family'} now. If they do not answer in 2 minutes, an ElderLink coordinator will call you. Do not pay anyone until then.` };
  });
  r('POST', '/scam/report', ({ db, user, body }) => {
    const senior = body.seniorId ? db.get('seniors', body.seniorId) : db.find('seniors', (s) => s.userId === user.id);
    assert(senior, 404, 'Senior not found');
    requireSenior(db, user, senior.id);
    const lost = !!body.lostMoney;
    const rep = db.insert('scamReports', { seniorId: senior.id, channel: body.channel || 'call', text: body.text || '', lostMoney: lost, amount: Number(body.amount) || 0, status: 'open', ref1930: null }, 'scm');
    notifyStaff(db, 'coordinator', { channels: ['push'], title: lost ? 'Scam with money lost' : 'Suspicious contact reported', body: `${senior.name}: ${body.text || body.channel}`, event: 'scam', critical: lost });
    if (lost) notifyCircle(db, senior.id, { channels: ['push', 'sms'], title: 'Possible fraud', body: `${senior.name} may have lost money to a scam. Call 1930 now and alert the bank.`, event: 'scam', critical: true });
    return {
      report: rep,
      steps: lost
        ? ['Call 1930 (National Cyber Crime Helpline) right now. Speed matters to freeze the money.', 'File a complaint at cybercrime.gov.in and note the reference number.', 'Call your bank to block the card / UPI and dispute the payment.', 'Do not call back the scammer or share any more details.']
        : ['Do not answer or call back the number.', 'Never share OTP, PIN or passwords. ElderLink and banks never ask for them.', 'A coordinator will call you with advice.'],
    };
  });
  r('GET', '/scam/reports', ({ db, user, query }) => {
    if (['coordinator', 'admin'].includes(user.role)) return db.all('scamReports').slice().reverse().map((x) => ({ ...x, seniorName: db.get('seniors', x.seniorId)?.name }));
    requireSenior(db, user, query.seniorId);
    return db.filter('scamReports', (x) => x.seniorId === query.seniorId).reverse();
  });
  r('POST', '/ops/scam/:id', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const rep = db.get('scamReports', params.id);
    Object.assign(rep, { status: 'advised', advice: body.advice || '', ref1930: body.ref1930 || rep.ref1930, advisedBy: user.name });
    db.dirty = true;
    return rep;
  });

  // ---- FR-SOC events and clubs ----
  r('GET', '/events', ({ db, user, query }) => {
    const rows = db.all('events').filter((e) => e.at > db.now() - 2 * HOUR).sort((a, b) => a.at - b.at);
    return rows.map((e) => ({ ...e, going: db.filter('rsvps', (x) => x.eventId === e.id).length + (e.baseAttendees || 0), joined: !!db.find('rsvps', (x) => x.eventId === e.id && x.seniorId === query.seniorId) }));
  });
  r('POST', '/events/:id/rsvp', ({ db, user, params, body }) => {
    const e = db.get('events', params.id);
    assert(e, 404, 'Event not found');
    const senior = body.seniorId ? db.get('seniors', body.seniorId) : db.find('seniors', (s) => s.userId === user.id);
    requireSenior(db, user, senior.id);
    const existing = db.find('rsvps', (x) => x.eventId === e.id && x.seniorId === senior.id);
    if (existing) { db.remove('rsvps', existing.id); return { joined: false }; }
    db.insert('rsvps', { eventId: e.id, seniorId: senior.id }, 'rsv');
    activity(db, senior.id, user, `joined "${e.title}"`, 'social');
    if (senior.userId) notify(db, { to: senior.userId, channels: ['whatsapp'], title: 'You are registered', body: `${e.title}, ${new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}. ${e.online ? 'We will send the link 15 minutes before.' : e.venue}`, event: 'event' });
    return { joined: true };
  });
  r('POST', '/seniors/:id/videocall', ({ db, user, params, body }) => {
    const { senior } = requireSenior(db, user, params.id);
    const to = body.userId ? db.get('users', body.userId) : null;
    const members = circleMembers(db, senior.id);
    const target = to || members.find((m) => m.userId === senior.nominee)?.user || members[0]?.user;
    notify(db, { to: target?.id, channels: ['push', 'voice'], title: 'Video call', body: `${user.name} is video calling you on ElderLink.`, event: 'video_call', seniorId: senior.id });
    activity(db, senior.id, user, `video called ${target?.name}`, 'social');
    return { ok: true, message: `Calling ${target?.name || 'family'}...`, name: target?.name };
  });

  // ---- FR-ENT entitlements and vault ----
  r('POST', '/entitlements/check', ({ db, user, body }) => {
    const { senior } = requireSenior(db, user, body.seniorId);
    const profile = { age: ageFromDob(senior.dob, db.now()), bpl: !!body.bpl, taxpayer: !!body.taxpayer, state: body.state || 'Karnataka' };
    const apps = db.filter('entitlementApps', (a) => a.seniorId === senior.id && a.kind === 'scheme');
    return { profile, schemes: SCHEMES.map((s) => ({ id: s.id, name: s.name, benefit: s.benefit, how: s.how, eligible: s.rule(profile), application: apps.find((a) => a.schemeId === s.id) || null })), note: 'Eligibility is indicative; rules and amounts vary by state and change over time. A coordinator confirms before applying.' };
  });
  r('POST', '/entitlements/apply', ({ db, user, body }) => {
    const { senior } = requireSenior(db, user, body.seniorId, 'manage');
    const s = SCHEMES.find((x) => x.id === body.schemeId);
    assert(s, 404, 'Scheme not found');
    const a = db.insert('entitlementApps', { kind: 'scheme', seniorId: senior.id, schemeId: s.id, name: s.name, status: 'documents_needed', steps: [{ at: db.now(), text: 'Request received; coordinator will call to collect documents' }] }, 'ent');
    notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Scheme enrolment help', body: `${senior.name}: ${s.name}`, event: 'entitlement' });
    activity(db, senior.id, user, `asked for help with ${s.name}`);
    return a;
  });
  r('GET', '/seniors/:id/vault', ({ db, user, params }) => {
    const { role } = requireSenior(db, user, params.id);
    return db.filter('vault', (v) => v.seniorId === params.id && (role !== 'viewer' || v.shareWith?.includes('viewer')));
  });
  r('POST', '/seniors/:id/vault', ({ db, user, params, body }) => {
    requireSenior(db, user, params.id, 'manage');
    assert(body.title && body.type, 400, 'Title and type are needed');
    const v = db.insert('vault', { seniorId: params.id, title: body.title, type: body.type, fileName: body.fileName || '', size: body.size || 0, shareWith: body.shareWith || ['owner', 'manager'], uploadedBy: user.name, encrypted: true }, 'vlt');
    activity(db, params.id, user, `added "${body.title}" to the document vault`);
    return v;
  });

  // ---- FR-PGT-01 academy and FR-VER-08 induction ----
  r('GET', '/academy', ({ db, user }) => {
    const cg = caregiverFor(db, user);
    assert(cg, 403, 'For caregivers');
    return db.all('courses').map((c) => ({ ...c, progress: db.find('courseProgress', (p) => p.courseId === c.id && p.caregiverId === cg.id) || null }));
  });
  r('POST', '/academy/:id/complete', ({ db, user, params, body }) => {
    const cg = caregiverFor(db, user);
    assert(cg, 403, 'For caregivers');
    const course = db.get('courses', params.id);
    assert(course, 404, 'Course not found');
    const score = Math.min(100, Math.max(0, Number(body.score) || 0));
    let p = db.find('courseProgress', (x) => x.courseId === course.id && x.caregiverId === cg.id);
    if (!p) p = db.insert('courseProgress', { courseId: course.id, caregiverId: cg.id }, 'cpr');
    Object.assign(p, { score: Math.max(score, p.score || 0), passed: score >= 80 || p.passed, at: db.now() });
    const induction = db.filter('courses', (c) => c.induction);
    const scores = induction.map((c) => db.find('courseProgress', (x) => x.courseId === c.id && x.caregiverId === cg.id)?.score || 0);
    cg.inductionScore = Math.round(scores.reduce((a, b) => a + b, 0) / induction.length);
    if (course.badge && score >= 80) cg.skillBadges = [...new Set([...(cg.skillBadges || []), course.badge])];
    db.dirty = true;
    return { progress: p, inductionScore: cg.inductionScore, passed: score >= 80 };
  });

  // FR-BKG-15 caregiver personal-safety alert
  r('POST', '/caregiver/panic', ({ db, user, body }) => {
    const cg = caregiverFor(db, user);
    assert(cg, 403, 'For caregivers');
    notifyStaff(db, 'emergency', { channels: ['push', 'voice'], title: 'Caregiver safety alert', body: `${cg.name} raised a personal-safety alert${body.bookingId ? ' during a visit' : ''}.`, event: 'caregiver_panic', critical: true });
    notifyStaff(db, 'coordinator', { channels: ['push'], title: 'Caregiver safety alert', body: cg.name, event: 'caregiver_panic', critical: true });
    return { ok: true, message: 'The emergency desk has been alerted and will call you now. If you are in danger, call 112.' };
  });

  // FR-PTN-05 referral
  r('POST', '/referral', ({ db, user, body }) => {
    assert(body.mobile, 400, 'Enter a mobile number');
    notify(db, { toName: body.name || 'Friend', toPhone: body.mobile, channels: ['sms', 'whatsapp'], title: 'Invite', body: `${user.name} invited you to ElderLink: verified nurses and care for parents, with SOS and medicine tracking. Use code ${user.id.slice(-5).toUpperCase()} for Rs 500 credit.`, event: 'referral' });
    return { ok: true, message: 'Invite sent. You get Rs 500 credit when they subscribe.' };
  });

  // demo helper: settle a referral reward
  r('POST', '/referral/reward', ({ db, user }) => { addCredit(db, user.id, 500, 'Referral reward'); return { ok: true }; });

}

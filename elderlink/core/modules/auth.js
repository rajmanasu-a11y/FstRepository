// FR-ONB-01, 02, 07, 09; NFR-09 (OTP login). SMS is mocked: the demo shows the OTP on screen.
import { assert, fail, normaliseMobile, randomDigits, MIN } from '../util.js';
import { audit, notify, circleRole } from '../context.js';

export const CONSENT_PURPOSES = [
  { id: 'care', label: 'Care delivery (booking and visits)', required: true },
  { id: 'circle', label: 'Sharing with my care circle (family members I invite)', required: true },
  { id: 'health', label: 'Processing health details (conditions, medicines, vitals)', required: true },
  { id: 'marketing', label: 'Offers and news from ElderLink', required: false },
];

export function publicUser(u) {
  if (!u) return null;
  const { id, role, name, mobile, email, language, prefs, tz, city, photo, relation, seniorId } = u;
  return { id, role, name, mobile, email, language, prefs: prefs || {}, tz, city, photo, relation, seniorId };
}

function newSession(db, user) {
  const token = 'tok_' + randomDigits(12) + Date.now().toString(36);
  db.insert('sessions', { token, userId: user.id }, 'ses');
  return { token, user: publicUser(user) };
}

function recordConsents(db, userId, consents = {}) {
  for (const p of CONSENT_PURPOSES) {
    const granted = p.required ? true : !!consents[p.id];
    db.insert('consents', { userId, purpose: p.id, version: 'v1.0', granted, at: db.now() }, 'con');
  }
}

export function routes(r) {
  r('GET', '/auth/personas', ({ db }) => db.filter('users', (u) => u.persona).sort((a, b) => a.persona.order - b.persona.order)
    .map((u) => ({ id: u.id, name: u.name, role: u.role, ...u.persona })), { public: true });

  r('GET', '/auth/consent-purposes', () => CONSENT_PURPOSES, { public: true });

  r('POST', '/auth/demo', ({ db, body }) => {
    const user = db.get('users', body.userId);
    assert(user && user.persona, 404, 'Demo person not found');
    return newSession(db, user);
  }, { public: true });

  r('POST', '/auth/otp', ({ db, body }) => {
    const mobile = normaliseMobile(body.mobile);
    assert(/^\+\d{8,15}$/.test(mobile), 400, 'Please enter a valid mobile number');
    const code = '123456'; // demo: real deployments send a random code by DLT-registered SMS
    db.insert('otps', { mobile, code, expiresAt: db.now() + 10 * MIN, used: false }, 'otp');
    const existing = db.find('users', (u) => u.mobile === mobile);
    notify(db, { toName: existing?.name || 'New user', toPhone: mobile, channels: ['sms'], title: 'ElderLink OTP', body: `Your ElderLink code is ${code}. Do not share it with anyone, not even ElderLink staff.`, event: 'otp' });
    return { sent: true, demoCode: code, existing: !!existing };
  }, { public: true });

  r('POST', '/auth/verify', ({ db, body }) => {
    const mobile = normaliseMobile(body.mobile);
    const otp = db.filter('otps', (o) => o.mobile === mobile && !o.used).pop();
    assert(otp && otp.code === String(body.code).trim() && otp.expiresAt > db.now(), 400, 'That code is not right. Please check the SMS and try again.');
    otp.used = true;
    let user = db.find('users', (u) => u.mobile === mobile);
    if (!user) {
      assert(body.name && body.name.trim().length > 1, 400, 'Please tell us your name');
      const role = ['family', 'senior', 'caregiver', 'provider_admin'].includes(body.role) ? body.role : 'family';
      assert(body.consentGiven, 400, 'Please agree to the required consents to continue');
      user = db.insert('users', { role, name: body.name.trim(), mobile, email: body.email || '', language: body.language || 'en', prefs: { seniorMode: role === 'senior' }, tz: body.tz || 'Asia/Kolkata' }, 'usr');
      recordConsents(db, user.id, body.consents);
      if (role === 'senior') {
        // FR-ONB-07: a senior can self-register and invite family later
        const s = db.insert('seniors', { userId: user.id, name: user.name, gender: body.gender || '', dob: body.dob || '1950-01-01', address: body.address || '', city: 'Bengaluru', lat: 12.9716, lng: 77.5946, languages: [user.language === 'hi' ? 'Hindi' : 'English'], conditions: [], allergies: [], mobility: 'Independent', cognition: 'Normal', emergencyContacts: [], consent: { status: 'given', method: 'self', at: db.now() } }, 'sen');
        user.seniorId = s.id;
        db.insert('carePlans', { seniorId: s.id, goals: [], routines: [], preferences: {}, doNot: [], version: 1 }, 'cpl');
      }
      if (role === 'caregiver') {
        const p = db.insert('providers', { type: 'independent', name: user.name, city: 'Bengaluru', status: 'draft', adminUserId: user.id, lat: 12.9716, lng: 77.5946, languages: ['English'] }, 'prv');
        db.insert('caregivers', { userId: user.id, providerId: p.id, name: user.name, category: body.category || 'GNM', gender: body.gender || 'F', languages: ['English'], status: 'draft', verification: { id: 'pending', registration: 'pending', police: 'pending', interview: 'pending' }, inductionScore: 0, lat: 12.9716, lng: 77.5946, availability: { days: [1, 2, 3, 4, 5, 6], from: '08:00', to: '18:00' } }, 'cg');
      }
      if (role === 'provider_admin') {
        // FR-ONB-04: an organisation signs up and goes into facility verification
        db.insert('providers', { type: body.orgType || 'agency', name: body.orgName || `${user.name}'s agency`, city: 'Bengaluru', status: 'draft', adminUserId: user.id, lat: 12.9716, lng: 77.5946, languages: ['English', 'Kannada', 'Hindi'], facility: { cea: 'pending', gst: 'pending', insurance: 'pending' } }, 'prv');
      }
      audit(db, user, 'user.register', user.id, { role });
    }
    return newSession(db, user);
  }, { public: true });

  r('POST', '/auth/logout', ({ db, token }) => {
    const s = db.find('sessions', (x) => x.token === token);
    if (s) s.revoked = true;
    return { ok: true };
  });

  r('GET', '/me', ({ db, user }) => {
    const unread = db.filter('notifications', (n) => n.userId === user.id && !n.read && n.channel === 'push').length;
    return { user: publicUser(user), unread };
  });

  r('PATCH', '/me', ({ db, user, body }) => {
    const patch = {};
    if (body.name) patch.name = String(body.name).slice(0, 80);
    if (['en', 'hi'].includes(body.language)) patch.language = body.language;
    if (body.prefs) patch.prefs = { ...(user.prefs || {}), ...body.prefs };
    if (body.tz) patch.tz = body.tz;
    db.update('users', user.id, patch);
    return publicUser(db.get('users', user.id));
  });

  r('GET', '/me/notifications', ({ db, user, query }) => {
    const list = db.filter('notifications', (n) => n.userId === user.id && (query.all || n.channel === 'push')).slice(-60).reverse();
    return list;
  });
  r('POST', '/me/notifications/read', ({ db, user }) => {
    for (const n of db.filter('notifications', (x) => x.userId === user.id)) n.read = true;
    db.dirty = true;
    return { ok: true };
  });

  // FR-ONB-02 / REG-01..03: consent ledger with one-tap withdrawal
  r('GET', '/me/consents', ({ db, user }) => {
    const ledger = db.filter('consents', (c) => c.userId === user.id);
    const current = CONSENT_PURPOSES.map((p) => {
      const last = ledger.filter((c) => c.purpose === p.id).pop();
      return { ...p, granted: last ? last.granted : false, at: last?.at };
    });
    return { current, ledger: ledger.slice().reverse() };
  });
  r('POST', '/me/consents', ({ db, user, body }) => {
    const p = CONSENT_PURPOSES.find((x) => x.id === body.purpose);
    assert(p, 400, 'Unknown purpose');
    db.insert('consents', { userId: user.id, purpose: p.id, version: 'v1.0', granted: !!body.granted, at: db.now() }, 'con');
    audit(db, user, body.granted ? 'consent.grant' : 'consent.withdraw', p.id);
    return { ok: true, warning: p.required && !body.granted ? 'Without this consent we cannot deliver care. Your request has been sent to our Data Protection Officer, who will call you.' : null };
  });

  // FR-ONB-09: export and delete
  r('GET', '/me/export', ({ db, user }) => {
    const seniorIds = db.filter('circle', (c) => c.userId === user.id).map((c) => c.seniorId);
    if (user.seniorId) seniorIds.push(user.seniorId);
    audit(db, user, 'data.export', user.id);
    return {
      exportedAt: new Date(db.now()).toISOString(), user: publicUser(user),
      consents: db.filter('consents', (c) => c.userId === user.id),
      seniors: db.filter('seniors', (s) => seniorIds.includes(s.id)),
      bookings: db.filter('bookings', (b) => seniorIds.includes(b.seniorId)).map((b) => ({ id: b.id, service: b.serviceName, start: b.start, status: b.status, total: b.price?.total })),
      payments: db.filter('payments', (p) => p.userId === user.id),
    };
  });
  r('POST', '/me/delete', ({ db, user }) => {
    db.update('users', user.id, { deletionRequestedAt: db.now() });
    const g = db.insert('grievances', { userId: user.id, userName: user.name, category: 'Data privacy', type: 'dpdp', subject: 'Erasure request', text: 'User asked to delete their account and data (FR-ONB-09).', priority: 'normal', status: 'open', ackDueAt: db.now() + 48 * 60 * MIN, resolveDueAt: db.now() + 30 * 24 * 60 * MIN }, 'grv');
    audit(db, user, 'data.delete_request', user.id);
    return { ok: true, grievanceId: g.id, message: 'Your deletion request is logged. It will complete within 30 days, except records the law requires us to keep.' };
  });

  r('GET', '/me/role-on/:seniorId', ({ db, user, params }) => ({ role: circleRole(db, user, params.seniorId) }));
  r('GET', '/auth/whoami', ({ user }) => (user ? publicUser(user) : fail(401, 'Not signed in')));
}

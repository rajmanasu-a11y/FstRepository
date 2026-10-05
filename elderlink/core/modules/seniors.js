// FR-ONB-03..06 (profiles, consent, care circle), FR-FAM-01..06 (care plan, tasks, approvals,
// activity), FR-DSH-02/03 (timeline, vitals trend).
import { assert, fail, normaliseMobile, ageFromDob, DAY } from '../util.js';
import { activity, audit, circleMembers, isStaff, notify, requireSenior, config } from '../context.js';
import { vitalsStatus } from '../rules.js';

export function seniorView(db, s, role) {
  const sub = db.find('subscriptions', (x) => x.seniorId === s.id && ['active', 'grace'].includes(x.status));
  const plan = sub ? db.get('plans', sub.planId) : null;
  const base = {
    id: s.id, name: s.name, photo: s.photo, gender: s.gender, dob: s.dob, age: ageFromDob(s.dob, db.now()), address: s.address,
    area: s.area, city: s.city, lat: s.lat, lng: s.lng, languages: s.languages, mobile: s.mobile, conditions: s.conditions,
    allergies: s.allergies, mobility: s.mobility, cognition: s.cognition, bloodGroup: s.bloodGroup, doctor: s.doctor,
    hospital: s.hospital, emergencyContacts: s.emergencyContacts, consent: s.consent, hasApp: !!s.userId,
    checkinSettings: s.checkinSettings, nominee: s.nominee, guardian: s.guardian, abha: s.abha,
    subscription: sub ? { id: sub.id, status: sub.status, plan: plan?.name, planId: sub.planId } : null, myRole: role,
  };
  return base;
}

export function seniorsFor(db, user) {
  if (user.role === 'senior') return db.filter('seniors', (s) => s.userId === user.id);
  if (isStaff(user)) return db.all('seniors').filter((s) => !s.background);
  const ids = db.filter('circle', (c) => c.userId === user.id && c.status !== 'removed').map((c) => c.seniorId);
  return db.filter('seniors', (s) => ids.includes(s.id));
}

export function routes(r) {
  r('GET', '/seniors', ({ db, user }) => seniorsFor(db, user).map((s) => {
    const m = db.find('circle', (c) => c.seniorId === s.id && c.userId === user.id);
    return seniorView(db, s, s.userId === user.id ? 'self' : m?.role || 'staff');
  }));

  r('POST', '/seniors', ({ db, user, body }) => {
    assert(['family', 'senior'].includes(user.role), 403, 'Only family members can add a senior');
    assert(body.name && body.dob, 400, 'Name and date of birth are needed');
    assert(body.address, 400, 'Please add the home address so nearby providers can be found');
    const s = db.insert('seniors', {
      name: body.name.trim(), gender: body.gender || '', dob: body.dob, address: body.address, area: body.area || '', city: body.city || 'Bengaluru',
      lat: Number(body.lat) || 12.9716, lng: Number(body.lng) || 77.5946, languages: body.languages || ['English'],
      mobile: body.mobile ? normaliseMobile(body.mobile) : '', conditions: body.conditions || [], allergies: body.allergies || [],
      mobility: body.mobility || 'Independent', cognition: body.cognition || 'Normal', bloodGroup: body.bloodGroup || '',
      doctor: body.doctor || '', hospital: body.hospital || '', emergencyContacts: body.emergencyContacts || [],
      consent: { status: body.cognition === 'Dementia' ? 'guardian_needed' : 'pending' },
      checkinSettings: { enabled: false, time: '09:00', human: false },
    }, 'sen');
    db.insert('circle', { seniorId: s.id, userId: user.id, role: 'owner', relation: body.relation || 'son / daughter', status: 'active' }, 'cir');
    db.insert('carePlans', { seniorId: s.id, goals: [], routines: [], preferences: {}, doNot: [], version: 1 }, 'cpl');
    activity(db, s.id, user, `added ${s.name}'s profile`);
    audit(db, user, 'senior.create', s.id);
    if (s.mobile) notify(db, { toName: s.name, toPhone: s.mobile, channels: ['sms'], title: 'Consent', body: `${user.name} has added you to ElderLink to arrange care. Your code to agree is 4321. Reply STOP to refuse.`, event: 'consent' });
    return seniorView(db, s, 'owner');
  });

  r('GET', '/seniors/:id', ({ db, user, params }) => {
    const { senior, role } = requireSenior(db, user, params.id);
    if (role === 'caregiver') {
      // FR-BKG-05: care-relevant profile only
      const v = seniorView(db, senior, role);
      return { ...v, mobile: undefined, subscription: undefined, medicines: db.filter('medicines', (m) => m.seniorId === senior.id && m.active) };
    }
    if (isStaff(user)) audit(db, user, 'senior.view', senior.id);
    return { ...seniorView(db, senior, role), circle: circleMembers(db, senior.id).map((m) => ({ id: m.id, userId: m.userId, role: m.role, relation: m.relation, name: m.user?.name, mobile: m.user?.mobile, status: m.status, tz: m.user?.tz, nominee: senior.nominee === m.userId })) };
  });

  r('PATCH', '/seniors/:id', ({ db, user, params, body }) => {
    const { senior } = requireSenior(db, user, params.id, 'manage');
    const allowed = ['name', 'gender', 'dob', 'address', 'area', 'mobile', 'languages', 'conditions', 'allergies', 'mobility', 'cognition', 'bloodGroup', 'doctor', 'hospital', 'emergencyContacts', 'nominee', 'abha', 'lat', 'lng'];
    const patch = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    if (patch.emergencyContacts) assert(patch.emergencyContacts.length <= 4, 400, 'Up to four emergency contacts');
    db.update('seniors', senior.id, patch);
    activity(db, senior.id, user, 'updated the profile');
    audit(db, user, 'senior.update', senior.id, Object.keys(patch));
    return seniorView(db, db.get('seniors', senior.id));
  });

  // FR-ONB-05: senior's own consent, or a guardian document approved by a coordinator
  r('POST', '/seniors/:id/consent', ({ db, user, params, body }) => {
    const { senior } = requireSenior(db, user, params.id, 'view');
    if (body.method === 'otp') {
      assert(String(body.code) === '4321', 400, 'That code is not right');
      db.update('seniors', senior.id, { consent: { status: 'given', method: 'otp', at: db.now() } });
    } else if (body.method === 'ivr') {
      db.update('seniors', senior.id, { consent: { status: 'given', method: 'ivr (recorded call)', at: db.now() } });
    } else if (body.method === 'guardian') {
      assert(body.document, 400, 'Please attach the guardianship or power-of-attorney document');
      db.update('seniors', senior.id, { consent: { status: 'guardian_review', method: 'guardian', document: body.document, at: db.now() }, guardian: user.id });
    } else if (body.method === 'approve_guardian') {
      assert(isStaff(user), 403, 'Only a coordinator can approve');
      db.update('seniors', senior.id, { consent: { ...senior.consent, status: 'given', approvedBy: user.name, at: db.now() } });
    } else fail(400, 'Unknown consent method');
    activity(db, senior.id, user, 'recorded consent');
    return seniorView(db, db.get('seniors', senior.id));
  });

  // FR-ONB-06 care circle
  r('POST', '/seniors/:id/circle', ({ db, user, params, body }) => {
    const { senior } = requireSenior(db, user, params.id, 'owner');
    const role = ['owner', 'manager', 'viewer'].includes(body.role) ? body.role : 'viewer';
    const mobile = normaliseMobile(body.mobile);
    assert(body.name && mobile.length > 8, 400, 'Name and mobile are needed');
    let member = db.find('users', (u) => u.mobile === mobile);
    if (!member) member = db.insert('users', { role: 'family', name: body.name, mobile, language: 'en', prefs: {}, tz: body.tz || 'Asia/Kolkata' }, 'usr');
    const existing = db.find('circle', (c) => c.seniorId === senior.id && c.userId === member.id && c.status !== 'removed');
    assert(!existing, 400, 'Already in the care circle');
    const c = db.insert('circle', { seniorId: senior.id, userId: member.id, role, relation: body.relation || 'family', status: 'invited', invitedBy: user.id }, 'cir');
    notify(db, { to: member.id, channels: ['sms', 'whatsapp'], title: 'Care circle invite', body: `${user.name} invited you to ${senior.name}'s care circle on ElderLink as ${role}.`, event: 'invite', seniorId: senior.id });
    activity(db, senior.id, user, `invited ${body.name} as ${role}`);
    return c;
  });
  r('PATCH', '/circle/:id', ({ db, user, params, body }) => {
    const c = db.get('circle', params.id);
    assert(c, 404, 'Not found');
    requireSenior(db, user, c.seniorId, 'owner');
    if (body.role) assert(['owner', 'manager', 'viewer'].includes(body.role), 400, 'Bad role');
    if (c.role === 'owner' && body.role && body.role !== 'owner') {
      const owners = db.filter('circle', (x) => x.seniorId === c.seniorId && x.role === 'owner' && x.status !== 'removed');
      assert(owners.length > 1, 400, 'A care circle needs at least one Owner');
    }
    db.update('circle', c.id, { role: body.role || c.role, status: body.remove ? 'removed' : c.status });
    activity(db, c.seniorId, user, body.remove ? 'removed a member' : `changed a member's role to ${body.role}`);
    return { ok: true };
  });

  // FR-FAM-01 shared care plan
  r('GET', '/seniors/:id/careplan', ({ db, user, params }) => {
    requireSenior(db, user, params.id);
    return db.find('carePlans', (p) => p.seniorId === params.id) || {};
  });
  r('PUT', '/seniors/:id/careplan', ({ db, user, params, body }) => {
    requireSenior(db, user, params.id, 'manage');
    let p = db.find('carePlans', (x) => x.seniorId === params.id);
    if (!p) p = db.insert('carePlans', { seniorId: params.id, version: 0 }, 'cpl');
    db.update('carePlans', p.id, { goals: body.goals || [], routines: body.routines || [], preferences: body.preferences || {}, doNot: body.doNot || [], version: (p.version || 0) + 1, updatedBy: user.name });
    activity(db, params.id, user, 'updated the care plan');
    return db.get('carePlans', p.id);
  });

  // FR-FAM-02 tasks
  r('GET', '/seniors/:id/tasks', ({ db, user, params }) => {
    requireSenior(db, user, params.id);
    return db.filter('tasks', (t) => t.seniorId === params.id).map((t) => ({ ...t, assigneeName: db.get('users', t.assigneeId)?.name }));
  });
  r('POST', '/seniors/:id/tasks', ({ db, user, params, body }) => {
    requireSenior(db, user, params.id);
    assert(body.title, 400, 'What needs doing?');
    const t = db.insert('tasks', { seniorId: params.id, title: body.title, assigneeId: body.assigneeId || user.id, due: body.due || null, done: false, createdBy: user.id }, 'tsk');
    if (t.assigneeId !== user.id) notify(db, { to: t.assigneeId, channels: ['push'], title: 'New task for you', body: `${user.name}: ${t.title}`, event: 'task', seniorId: params.id });
    activity(db, params.id, user, `added task "${t.title}"`);
    return t;
  });
  r('PATCH', '/tasks/:id', ({ db, user, params, body }) => {
    const t = db.get('tasks', params.id);
    assert(t, 404, 'Not found');
    requireSenior(db, user, t.seniorId);
    db.update('tasks', t.id, { done: !!body.done });
    if (body.done) activity(db, t.seniorId, user, `completed "${t.title}"`);
    return t;
  });

  // FR-FAM-06 activity feed
  r('GET', '/seniors/:id/activity', ({ db, user, params }) => {
    requireSenior(db, user, params.id);
    return db.filter('activity', (a) => a.seniorId === params.id).slice(-80).reverse();
  });

  // FR-FAM-03 approval rules
  r('GET', '/seniors/:id/approval-rule', ({ db, user, params }) => {
    requireSenior(db, user, params.id);
    return db.find('approvalRules', (a) => a.seniorId === params.id) || { seniorId: params.id, enabled: false, threshold: config(db).approvalThreshold };
  });
  r('PUT', '/seniors/:id/approval-rule', ({ db, user, params, body }) => {
    requireSenior(db, user, params.id, 'owner');
    let rule = db.find('approvalRules', (a) => a.seniorId === params.id);
    if (!rule) rule = db.insert('approvalRules', { seniorId: params.id }, 'apr');
    db.update('approvalRules', rule.id, { enabled: !!body.enabled, threshold: Math.max(0, Number(body.threshold) || 0) });
    activity(db, params.id, user, body.enabled ? `set approval for bookings over Rs ${body.threshold}` : 'turned off spend approvals');
    return rule;
  });

  // FR-DSH-02 timeline of everything
  r('GET', '/seniors/:id/timeline', ({ db, user, params, query }) => {
    requireSenior(db, user, params.id);
    const sid = params.id;
    const items = [];
    for (const b of db.filter('bookings', (x) => x.seniorId === sid)) items.push({ type: 'visit', at: b.start, title: b.serviceName, sub: `${b.providerName}${b.caregiverName ? ' · ' + b.caregiverName : ''}`, status: b.status, id: b.id });
    for (const c of db.filter('cases', (x) => x.seniorId === sid)) items.push({ type: 'sos', at: c.createdAt, title: `SOS: ${c.reason || c.trigger}`, sub: c.outcome || c.status, status: c.status, id: c.id });
    for (const d of db.filter('doses', (x) => x.seniorId === sid && ['missed', 'skipped'].includes(x.status))) items.push({ type: 'dose', at: d.due, title: `${d.medName} ${d.status}`, status: d.status, id: d.id });
    for (const p of db.filter('payments', (x) => x.seniorId === sid)) items.push({ type: 'payment', at: p.createdAt, title: `Paid Rs ${p.amount}`, sub: p.purpose, status: p.status, id: p.id });
    for (const v of db.filter('vitals', (x) => x.seniorId === sid)) items.push({ type: 'report', at: v.at, title: 'Vitals recorded', sub: `BP ${v.bpSys ?? '-'}/${v.bpDia ?? '-'} · SpO2 ${v.spo2 ?? '-'}%`, status: vitalsStatus(v, config(db).vitalThresholds).overall, id: v.id });
    for (const h of db.filter('helplineCalls', (x) => x.seniorId === sid)) items.push({ type: 'helpline', at: h.createdAt, title: 'Nurse helpline', sub: h.advice || h.question, status: h.status, id: h.id });
    const filtered = query.type ? items.filter((i) => i.type === query.type) : items;
    return filtered.filter((i) => i.at <= db.now() + 30 * DAY).sort((a, b) => b.at - a.at).slice(0, 150);
  });

  // FR-CHK-08 / FR-DSH-03 vitals trend
  r('GET', '/seniors/:id/vitals', ({ db, user, params, query }) => {
    requireSenior(db, user, params.id);
    const days = Number(query.days) || 90;
    const since = db.now() - days * DAY;
    return db.filter('vitals', (v) => v.seniorId === params.id && v.at >= since).sort((a, b) => a.at - b.at)
      .map((v) => ({ ...v, status: vitalsStatus(v, config(db).vitalThresholds) }));
  });
}

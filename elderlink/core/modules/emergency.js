// FR-EMG (emergency response), FR-SAF-03 (non-medical emergencies), FR-ADM-04 (emergency desk).
import { assert, MIN } from '../util.js';
import { activity, audit, caregiverFor, isStaff, notify, notifyCircle, notifyStaff, requireRole, requireSenior } from '../context.js';
import { TRIAGE } from '../catalog.js';

function add(c, kind, text, db) { c.timeline.push({ at: db.now(), kind, text }); db.dirty = true; }

export function medicalSummary(db, s) {
  const meds = db.filter('medicines', (m) => m.seniorId === s.id && m.active).map((m) => `${m.name} ${m.strength}`);
  return {
    name: s.name, age: Math.floor((db.now() - Date.parse(s.dob)) / (365.25 * 86400000)), gender: s.gender, bloodGroup: s.bloodGroup,
    conditions: s.conditions, allergies: s.allergies, mobility: s.mobility, cognition: s.cognition, medicines: meds,
    address: s.address, doctor: s.doctor, hospital: s.hospital, emergencyContacts: s.emergencyContacts,
  };
}

/** FR-EMG-02 / 03: create the case and alert everyone within seconds. */
export function raiseSos(db, { senior, trigger, by, lat, lng, offline = false, note }) {
  const open = db.find('cases', (c) => c.seniorId === senior.id && c.status !== 'closed');
  if (open) { add(open, 'trigger', `Another SOS from ${trigger}`, db); return open; }
  const sub = db.find('subscriptions', (s) => s.seniorId === senior.id && ['active', 'grace', 'cancelling'].includes(s.status));
  const c = db.insert('cases', {
    seniorId: senior.id, seniorName: senior.name, trigger, triggeredBy: by?.name || senior.name, status: 'open',
    location: lat ? { lat, lng, source: 'GPS' } : { lat: senior.lat, lng: senior.lng, source: 'registered address' },
    offline, note: note || '', covered: !!sub, summary: medicalSummary(db, senior), timeline: [], ambulance: null,
  }, 'sos');
  add(c, 'trigger', `SOS raised by ${by?.name || senior.name} (${trigger})${offline ? ' with no data connection: SMS with location sent and call placed to SOS number' : ''}`, db);
  const body = `SOS from ${senior.name} at ${senior.address}. Our emergency desk is responding. Open ElderLink to follow live.`;
  notifyCircle(db, senior.id, { channels: ['push', 'sms', 'voice'], title: 'SOS: emergency alert', body, event: 'sos', critical: true });
  for (const ec of senior.emergencyContacts || []) notify(db, { toName: ec.name, toPhone: ec.phone, channels: ['sms', 'voice'], title: 'SOS: emergency alert', body: `${senior.name} pressed SOS. Please call or go to the home if you can. ElderLink desk is on it.`, event: 'sos', critical: true, seniorId: senior.id });
  notifyStaff(db, 'emergency', { channels: ['push', 'voice'], title: 'NEW SOS', body: `${senior.name}, ${senior.area || senior.city}`, event: 'sos', critical: true });
  add(c, 'notify', `Care circle (${(db.filter('circle', (m) => m.seniorId === senior.id && m.status !== 'removed')).length}) and ${senior.emergencyContacts?.length || 0} emergency contacts alerted by push, SMS and voice`, db);
  if (!sub) add(c, 'info', 'No active plan: the desk still responds and will call 108 if needed.', db);
  activity(db, senior.id, by, `raised SOS (${trigger})`, 'sos');
  return c;
}

function getCase(db, id) { const c = db.get('cases', id); assert(c, 404, 'Case not found'); return c; }

export function routes(r) {
  r('POST', '/sos', ({ db, user, body }) => {
    let senior = body.seniorId ? db.get('seniors', body.seniorId) : db.find('seniors', (s) => s.userId === user.id);
    assert(senior, 404, 'Senior not found');
    let trigger = 'app';
    if (user.role === 'caregiver') {
      const cg = caregiverFor(db, user);
      assert(db.find('bookings', (b) => b.caregiverId === cg?.id && b.seniorId === senior.id && ['assigned', 'in_progress', 'completed'].includes(b.status)), 403, 'You can raise SOS only for a senior you are visiting');
      trigger = 'caregiver panic button';
    } else {
      const { role } = requireSenior(db, user, senior.id);
      trigger = role === 'self' ? (body.source || 'senior app (long press)') : `family member (${user.name})`;
    }
    const c = raiseSos(db, { senior, trigger, by: user, lat: body.lat, lng: body.lng, offline: !!body.offline, note: body.note });
    return c;
  });

  r('GET', '/cases', ({ db, user, query }) => {
    if (isStaff(user)) {
      let rows = db.all('cases');
      if (query.status === 'open') rows = rows.filter((c) => c.status !== 'closed');
      return rows.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    }
    const sid = query.seniorId;
    requireSenior(db, user, sid);
    return db.filter('cases', (c) => c.seniorId === sid).sort((a, b) => b.createdAt - a.createdAt);
  });

  r('GET', '/cases/:id', ({ db, user, params }) => {
    const c = getCase(db, params.id);
    if (!isStaff(user)) requireSenior(db, user, c.seniorId);
    else audit(db, user, 'case.view', c.id);
    return { ...c, triage: TRIAGE, now: db.now() };
  });

  // FR-EMG-04 / 05
  r('POST', '/cases/:id/ack', ({ db, user, params }) => {
    requireRole(user, 'emergency', 'coordinator', 'admin');
    const c = getCase(db, params.id);
    assert(c.status === 'open', 400, 'Already acknowledged');
    c.status = 'acknowledged'; c.agentId = user.id; c.agentName = user.name; c.ackAt = db.now();
    add(c, 'ack', `${user.name} acknowledged in ${Math.round((c.ackAt - c.createdAt) / 1000)} s`, db);
    notifyCircle(db, c.seniorId, { channels: ['push'], title: 'Emergency desk responding', body: `${user.name} from the ElderLink desk is handling ${c.seniorName}'s SOS.`, event: 'sos', critical: true });
    return c;
  });

  r('POST', '/cases/:id/triage', ({ db, user, params, body }) => {
    requireRole(user, 'emergency', 'coordinator', 'admin');
    const c = getCase(db, params.id);
    assert(['medical', 'safety', 'nonurgent'].includes(body.type), 400, 'Pick medical, safety or non-urgent');
    c.type = body.type; c.reason = body.reason || ''; c.status = 'in_progress';
    add(c, 'triage', `Triage: ${body.type}${body.reason ? ' (' + body.reason + ')' : ''}`, db);
    return c;
  });

  // FR-EMG-06..09
  r('POST', '/cases/:id/action', ({ db, user, params, body }) => {
    requireRole(user, 'emergency', 'coordinator', 'admin');
    const c = getCase(db, params.id);
    assert(c.status !== 'closed', 400, 'Case is closed');
    const senior = db.get('seniors', c.seniorId);
    const k = body.kind;
    const texts = {
      call_senior: body.answered === false ? `Called ${c.seniorName}: no answer` : `Called ${c.seniorName}: answered`,
      call_contact: `Called emergency contact ${body.name || senior.emergencyContacts?.[0]?.name || ''}: asked to go to the home`,
      call_112: 'Called 112 (police / fire)',
      call_108: 'Handed off to 108 ambulance',
      inform_hospital: `Informed ${senior.hospital || 'preferred hospital'}; medical summary shared`,
      nearby_caregiver: 'Asked nearby verified caregiver to check in person',
      gas_agency: 'Called gas agency emergency line',
      repair_partner: 'Dispatched verified repair partner',
      arrived: 'Ambulance arrived at the home',
      hospital_reached: `Reached ${body.hospital || senior.hospital || 'hospital'}`,
      note: body.note || 'Note',
    };
    if (k === 'dispatch_ambulance') {
      c.ambulance = { partner: body.partner || 'MedRide Ambulance (partner)', eta: Number(body.eta) || 14, dispatchedAt: db.now(), vehicle: 'KA-01-AM-' + (1000 + Math.floor(Math.random() * 9000)) };
      add(c, 'dispatch', `Ambulance dispatched: ${c.ambulance.partner}, ${c.ambulance.vehicle}, ETA ${c.ambulance.eta} min. Medical summary shared with crew.`, db);
      notifyCircle(db, c.seniorId, { channels: ['push', 'sms'], title: 'Ambulance on the way', body: `Ambulance ${c.ambulance.vehicle} is on the way to ${c.seniorName}, ETA ${c.ambulance.eta} min.`, event: 'sos', critical: true });
    } else {
      assert(texts[k], 400, 'Unknown action');
      if (k === 'arrived' && c.ambulance) c.ambulance.arrivedAt = db.now();
      if (k === 'hospital_reached') c.hospital = body.hospital || senior.hospital;
      if (k === 'call_senior' && body.answered === false) c.seniorUnreachable = true;
      add(c, k, texts[k] + (body.note && k !== 'note' ? ` (${body.note})` : ''), db);
      if (['arrived', 'hospital_reached', 'call_112'].includes(k)) notifyCircle(db, c.seniorId, { channels: ['push'], title: 'SOS update', body: `${c.seniorName}: ${texts[k]}`, event: 'sos', critical: true });
    }
    if (c.status === 'acknowledged') c.status = 'in_progress';
    return c;
  });

  r('POST', '/cases/:id/close', ({ db, user, params, body }) => {
    requireRole(user, 'emergency', 'coordinator', 'admin');
    const c = getCase(db, params.id);
    assert(body.outcome, 400, 'Choose an outcome');
    c.status = 'closed'; c.outcome = body.outcome; c.closedAt = db.now(); c.closeNotes = body.notes || ''; if (body.hospital) c.hospital = body.hospital;
    c.followUpDueAt = db.now() + 24 * 60 * MIN;
    add(c, 'close', `Closed by ${user.name}: ${body.outcome}${body.notes ? '. ' + body.notes : ''}`, db);
    notifyCircle(db, c.seniorId, { channels: ['push', 'whatsapp'], title: 'SOS closed', body: `${c.seniorName}'s emergency is closed: ${body.outcome}. Your coordinator will follow up within 24 hours.`, event: 'sos' });
    activity(db, c.seniorId, user, `closed SOS: ${body.outcome}`, 'sos');
    return c;
  });

  r('POST', '/cases/:id/followup', ({ db, user, params, body }) => {
    requireRole(user, 'coordinator', 'admin');
    const c = getCase(db, params.id);
    c.followUp = { at: db.now(), by: user.name, notes: body.notes || '' };
    add(c, 'followup', `Coordinator follow-up: ${body.notes || 'done'}`, db);
    return c;
  });

  // FR-EMG-12 test SOS
  r('POST', '/seniors/:id/test-sos', ({ db, user, params }) => {
    const { senior } = requireSenior(db, user, params.id, 'manage');
    notify(db, { to: senior.userId, toName: senior.name, toPhone: senior.mobile, channels: ['voice'], title: 'Test SOS', body: 'This is ElderLink\'s monthly SOS test. Your SOS is working. No action is needed.', event: 'sos_test', seniorId: senior.id });
    for (const ec of senior.emergencyContacts || []) notify(db, { toName: ec.name, toPhone: ec.phone, channels: ['sms'], title: 'Test SOS', body: `Monthly test: you are an emergency contact for ${senior.name} on ElderLink. Please reply OK.`, event: 'sos_test', seniorId: senior.id });
    activity(db, senior.id, user, 'ran a test SOS');
    return { ok: true, message: 'Test call placed to the senior and test SMS sent to emergency contacts.' };
  });

  // FR-EMG-13 / REG-14 safeguarding
  r('POST', '/seniors/:id/safeguard', ({ db, user, params, body }) => {
    const s = db.get('seniors', params.id);
    assert(s, 404, 'Not found');
    if (user.role !== 'caregiver') requireSenior(db, user, s.id);
    const g = db.insert('grievances', { userId: user.id, userName: user.name, seniorId: s.id, category: 'Safety / abuse', type: 'safeguarding', subject: 'Safeguarding concern', text: body.text || '', priority: 'P0', status: 'open', ackDueAt: db.now() + 60 * MIN, resolveDueAt: db.now() + 24 * 60 * MIN }, 'grv');
    notifyStaff(db, 'coordinator', { channels: ['push', 'sms'], title: 'Safeguarding concern (P0)', body: `${s.name}: ${body.text || ''}`, event: 'safeguarding', critical: true });
    return { grievance: g, message: 'A coordinator will respond within 1 hour. If someone is in danger now, press SOS or call 112. Elderline: 14567.' };
  });

}

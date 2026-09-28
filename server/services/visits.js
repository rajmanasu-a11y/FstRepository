import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { conflict, notFound, validationError, forbidden, AppError } from '../lib/errors.js';
import { localDate, localYear, addDays } from '../lib/time.js';
import { audit } from './audit.js';
import { getSetting, orgTimezone } from './settings.js';
import { refreshVisitorStats } from './visitors.js';
import { notifyHost, notifyRoles, arrivalMessage } from './notifications.js';

export const STATUSES = ['EXPECTED', 'PENDING_APPROVAL', 'APPROVED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'CANCELLED', 'OVERSTAY'];
export const ACTIVE_STATUSES = ['CHECKED_IN', 'OVERSTAY'];
const CHECK_IN_FROM = ['EXPECTED', 'APPROVED'];
const CANCELLABLE = ['EXPECTED', 'PENDING_APPROVAL', 'APPROVED'];

export const STATUS_LABELS = {
  EXPECTED: 'Expected',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  CHECKED_IN: 'Checked-In',
  CHECKED_OUT: 'Checked-Out',
  DENIED: 'Denied',
  CANCELLED: 'Cancelled',
  OVERSTAY: 'Overstay',
};

export const newQrToken = () => crypto.randomBytes(24).toString('base64url');

export function formatClock(tz, at) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(at).toUpperCase();
}

export const VISIT_SELECT = `
  vi.id, vi.visit_code, vi.visitor_id, vi.company_id, vi.host_employee_id, vi.department_id,
  vi.host_name_snapshot, vi.host_designation_snapshot, vi.purpose_id, vi.purpose_other, vi.category_id, vi.access_area_id,
  vi.appointment_type, vi.appointment_date, vi.expected_arrival, vi.expected_duration_min, vi.appointment_reference,
  vi.is_preregistered, vi.special_instructions, vi.qr_token, vi.status, vi.entry_point,
  vi.id_verified, vi.id_verified_at, vi.verification_remarks, vi.consent_given, vi.consent_at, vi.consent_text_version,
  vi.vehicle_id, vi.driver_name, vi.parking_required, vi.vehicle_remarks,
  vi.arrived_at, vi.check_in_at, vi.valid_until, vi.check_out_at, vi.duration_minutes, vi.overstay_flagged_at,
  vi.host_notified_at, vi.closed_at, vi.status_reason, vi.remarks, vi.created_at, vi.updated_at, vi.row_version,
  v.visitor_code, v.full_name AS visitor_name, v.mobile_country_code, v.mobile_number, v.email::text AS visitor_email,
  v.designation AS visitor_designation, v.photo_file_id, v.watchlist_status, v.watchlist_reason, v.total_visits,
  v.id_reference, vit.name AS id_type_name,
  c.name AS company_name,
  e.employee_code AS host_employee_code, e.salutation AS host_salutation, e.full_name AS host_current_name,
  e.official_mobile AS host_mobile, e.location AS host_location,
  d.name AS department_name,
  p.name AS purpose_name, p.requires_specify AS purpose_requires_specify,
  cat.name AS category_name, cat.roll_call_group, cat.requires_id AS category_requires_id,
  aa.name AS access_area_name, aa.is_restricted AS access_area_restricted,
  veh.registration_number AS vehicle_number, veh.vehicle_type,
  pass.pass_number, pass.status AS pass_status, pass.issued_at AS pass_issued_at, pass.print_count AS pass_print_count,
  cu.full_name AS created_by_name, ciu.full_name AS checked_in_by_name, cou.full_name AS checked_out_by_name,
  ivu.full_name AS id_verified_by_name,
  CASE WHEN vi.status IN ('CHECKED_IN', 'OVERSTAY') THEN floor(extract(epoch FROM now() - vi.check_in_at) / 60)::int
       ELSE vi.duration_minutes END AS elapsed_minutes`;

export const VISIT_JOINS = `
  FROM visits vi
  JOIN visitors v ON v.id = vi.visitor_id
  LEFT JOIN id_types vit ON vit.id = v.id_type_id
  LEFT JOIN companies c ON c.id = vi.company_id
  JOIN employees e ON e.id = vi.host_employee_id
  JOIN departments d ON d.id = vi.department_id
  JOIN purposes p ON p.id = vi.purpose_id
  JOIN visitor_categories cat ON cat.id = vi.category_id
  LEFT JOIN access_areas aa ON aa.id = vi.access_area_id
  LEFT JOIN vehicles veh ON veh.id = vi.vehicle_id
  LEFT JOIN visitor_passes pass ON pass.visit_id = vi.id AND pass.status <> 'VOID'
  LEFT JOIN users cu ON cu.id = vi.created_by
  LEFT JOIN users ciu ON ciu.id = vi.checked_in_by
  LEFT JOIN users cou ON cou.id = vi.checked_out_by
  LEFT JOIN users ivu ON ivu.id = vi.id_verified_by`;

export function purposeText(r) {
  return r.purpose_other ? `${r.purpose_name} – ${r.purpose_other}` : r.purpose_name;
}

export function shapeVisit(r) {
  if (!r) return null;
  return {
    id: r.id,
    visitCode: r.visit_code,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status],
    statusReason: r.status_reason,
    visitor: {
      id: r.visitor_id,
      visitorCode: r.visitor_code,
      fullName: r.visitor_name,
      mobileCountryCode: r.mobile_country_code,
      mobileNumber: r.mobile_number,
      email: r.visitor_email,
      designation: r.visitor_designation,
      photoUrl: r.photo_file_id ? `/api/files/photos/${r.photo_file_id}` : null,
      watchlistStatus: r.watchlist_status,
      watchlistReason: r.watchlist_reason,
      totalVisits: r.total_visits,
      idTypeName: r.id_type_name,
      idReference: r.id_reference,
    },
    companyId: r.company_id,
    companyName: r.company_name,
    host: {
      id: r.host_employee_id,
      employeeCode: r.host_employee_code,
      name: r.host_name_snapshot,
      salutation: r.host_salutation,
      designation: r.host_designation_snapshot,
      mobile: r.host_mobile,
      location: r.host_location,
    },
    departmentId: r.department_id,
    departmentName: r.department_name,
    purposeId: r.purpose_id,
    purposeName: r.purpose_name,
    purposeOther: r.purpose_other,
    purpose: purposeText(r),
    categoryId: r.category_id,
    categoryName: r.category_name,
    rollCallGroup: r.roll_call_group,
    categoryRequiresId: r.category_requires_id,
    accessAreaId: r.access_area_id,
    accessAreaName: r.access_area_name,
    accessAreaRestricted: r.access_area_restricted,
    appointmentType: r.appointment_type,
    appointmentDate: r.appointment_date,
    expectedArrival: r.expected_arrival ? String(r.expected_arrival).slice(0, 5) : null,
    expectedDurationMin: r.expected_duration_min,
    appointmentReference: r.appointment_reference,
    isPreregistered: r.is_preregistered,
    specialInstructions: r.special_instructions,
    qrToken: r.qr_token,
    entryPoint: r.entry_point,
    idVerified: r.id_verified,
    idVerifiedAt: r.id_verified_at,
    idVerifiedByName: r.id_verified_by_name,
    verificationRemarks: r.verification_remarks,
    consentGiven: r.consent_given,
    consentAt: r.consent_at,
    consentTextVersion: r.consent_text_version,
    vehicle: r.vehicle_id ? {
      id: r.vehicle_id,
      registrationNumber: r.vehicle_number,
      vehicleType: r.vehicle_type,
      driverName: r.driver_name,
      parkingRequired: r.parking_required,
      remarks: r.vehicle_remarks,
    } : null,
    arrivedAt: r.arrived_at,
    checkInAt: r.check_in_at,
    validUntil: r.valid_until,
    checkOutAt: r.check_out_at,
    durationMinutes: r.duration_minutes,
    elapsedMinutes: r.elapsed_minutes,
    overstayFlaggedAt: r.overstay_flagged_at,
    hostNotifiedAt: r.host_notified_at,
    closedAt: r.closed_at,
    remarks: r.remarks,
    pass: r.pass_number ? { passNumber: r.pass_number, status: r.pass_status, issuedAt: r.pass_issued_at, printCount: r.pass_print_count } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdByName: r.created_by_name,
    checkedInByName: r.checked_in_by_name,
    checkedOutByName: r.checked_out_by_name,
    rowVersion: r.row_version,
  };
}

/** Load a visit by id, visit code, pass number or QR token. */
export async function getVisit(key, runner = { query }) {
  let where;
  const k = String(key ?? '').trim();
  if (/^\d+$/.test(k)) where = 'vi.id = $1';
  else if (/^VST-/i.test(k)) where = 'vi.visit_code = upper($1)';
  else if (/^PASS-/i.test(k)) where = 'pass.pass_number = upper($1)';
  else if (/^[A-Za-z0-9_-]{20,64}$/.test(k)) where = 'vi.qr_token = $1';
  else throw notFound('Visit record not found.');
  const { rows } = await runner.query(`SELECT ${VISIT_SELECT} ${VISIT_JOINS} WHERE ${where}`, [k]);
  if (!rows[0]) throw notFound('Visit record not found.');
  return shapeVisit(rows[0]);
}

export async function visitTimeline(visitId) {
  const { rows } = await query(
    `SELECT h.id, h.from_status, h.to_status, h.event, h.remarks, h.changed_at, u.full_name AS changed_by_name
       FROM visit_status_history h LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.visit_id = $1 ORDER BY h.changed_at, h.id`, [visitId],
  );
  return rows.map((r) => ({
    id: r.id, fromStatus: r.from_status, toStatus: r.to_status, event: r.event, remarks: r.remarks,
    changedAt: r.changed_at, changedByName: r.changed_by_name || 'System',
  }));
}

async function recordStatus(client, visitId, from, to, event, remarks, userId) {
  await client.query(
    `INSERT INTO visit_status_history (visit_id, from_status, to_status, event, remarks, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [visitId, from, to, event, remarks ?? null, userId ?? null],
  );
}

async function lockVisit(client, visitId) {
  const { rows } = await client.query(
    `SELECT vi.*, v.full_name AS visitor_name, v.watchlist_status, v.watchlist_reason, v.photo_file_id, v.record_status,
            cat.requires_id AS category_requires_id, cat.name AS category_name
       FROM visits vi JOIN visitors v ON v.id = vi.visitor_id JOIN visitor_categories cat ON cat.id = vi.category_id
      WHERE vi.id = $1 FOR UPDATE OF vi`, [visitId],
  );
  if (!rows[0]) throw notFound('Visit record not found.');
  return rows[0];
}

async function upsertVehicle(client, vehicle, visitorId) {
  if (!vehicle?.registrationNumber) return null;
  const { rows } = await client.query(
    `INSERT INTO vehicles (registration_number, vehicle_type, last_visitor_id) VALUES ($1, $2, $3)
     ON CONFLICT (registration_number) DO UPDATE SET vehicle_type = EXCLUDED.vehicle_type, last_visitor_id = EXCLUDED.last_visitor_id
     RETURNING id`,
    [vehicle.registrationNumber, vehicle.vehicleType || 'CAR', visitorId],
  );
  return rows[0].id;
}

async function loadMasters(client, input) {
  const [hostRes, purposeRes, categoryRes, areaRes, deptRes] = await Promise.all([
    client.query(`SELECT e.id, e.salutation, e.full_name, e.designation, e.department_id, e.is_active, e.deleted_at
                    FROM employees e WHERE e.id = $1`, [input.hostEmployeeId]),
    client.query('SELECT id, name, requires_specify, is_active FROM purposes WHERE id = $1', [input.purposeId]),
    input.categoryId
      ? client.query('SELECT id, name, requires_approval, requires_id, is_active FROM visitor_categories WHERE id = $1', [input.categoryId])
      : client.query(`SELECT id, name, requires_approval, requires_id, is_active FROM visitor_categories WHERE code = 'GUEST'`),
    input.accessAreaId ? client.query('SELECT id, name, requires_approval, is_restricted, is_active FROM access_areas WHERE id = $1', [input.accessAreaId]) : { rows: [null] },
    input.departmentId ? client.query('SELECT id, is_active, deleted_at FROM departments WHERE id = $1', [input.departmentId]) : { rows: [null] },
  ]);
  const fields = {};
  const h = hostRes.rows[0];
  if (!h || !h.is_active || h.deleted_at) fields.hostEmployeeId = 'Select a valid, active Host / Officer to be Met';
  const p = purposeRes.rows[0];
  if (!p || !p.is_active) fields.purposeId = 'Select a valid Purpose of Visit';
  else if (p.requires_specify && !input.purposeOther) fields.purposeOther = 'Please specify the purpose of visit';
  const cat = categoryRes.rows[0];
  if (!cat || !cat.is_active) fields.categoryId = 'Select a valid Visitor Category';
  const area = areaRes.rows[0];
  if (input.accessAreaId && (!area || !area.is_active)) fields.accessAreaId = 'Select a valid Access Area';
  const d = deptRes.rows[0];
  if (input.departmentId && (!d || !d.is_active || d.deleted_at)) fields.departmentId = 'Select a valid Department / Section';
  if (Object.keys(fields).length) throw validationError(fields);
  return { host: h, purpose: p, category: cat, area };
}

/**
 * Create a visit transaction for an existing visitor master.
 * Decides the initial status (EXPECTED / PENDING_APPROVAL / APPROVED / DENIED),
 * raises the approval request and alerts, and optionally checks in.
 */
export async function createVisit(client, input, ctx, { mode = 'WALK_IN', createdByHost = false, checkIn = false } = {}) {
  const tz = await orgTimezone();
  const visitorSettings = await getSetting('visitor');
  const org = await getSetting('organisation');
  const today = localDate(tz);

  const { rows: vRows } = await client.query(
    'SELECT id, visitor_code, full_name, company_id, watchlist_status, watchlist_reason, record_status FROM visitors WHERE id = $1 FOR UPDATE',
    [input.visitorId],
  );
  const visitor = vRows[0];
  if (!visitor) throw notFound('Visitor record not found.');
  if (visitor.record_status !== 'ACTIVE') throw conflict('This visitor record is archived. Please restore it before registering a visit.');

  const { host, purpose, category, area } = await loadMasters(client, input);

  // Appointment date / time validation.
  const appointmentDate = input.appointmentDate || today;
  const fields = {};
  if (appointmentDate < today) fields.appointmentDate = 'Appointment Date cannot be in the past';
  if (appointmentDate > addDays(today, 365)) fields.appointmentDate = 'Appointment Date cannot be more than one year ahead';
  const maxDuration = Number(visitorSettings.maxDurationMinutes) || 480;
  const duration = input.expectedDurationMin || Number(visitorSettings.defaultDurationMinutes) || 60;
  if (duration > maxDuration) fields.expectedDurationMin = `Expected Duration cannot exceed ${Math.round(maxDuration / 60 * 10) / 10} hours`;
  if (mode === 'PREREG' && appointmentDate === today && input.expectedArrival) {
    const nowLocal = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    if (input.expectedArrival < nowLocal && addMinutes(input.expectedArrival, 60) < nowLocal) {
      fields.expectedArrival = 'Expected Arrival time has already passed for today';
    }
  }
  if (checkIn && appointmentDate > today) {
    fields.appointmentDate = 'Check-in is only possible for visits scheduled today. Save the registration for a future appointment instead.';
  }
  if (Object.keys(fields).length) throw validationError(fields);

  const departmentId = input.departmentId || host.department_id;
  const isFuture = appointmentDate > today;
  const needsApproval = !createdByHost && (
    category.requires_approval || area?.requires_approval || (mode === 'WALK_IN' && visitorSettings.requireApprovalForWalkIns)
  );

  let status;
  let statusReason = null;
  const alerts = [];
  if (visitor.watchlist_status === 'BLOCKED') {
    status = 'DENIED';
    statusReason = `Restricted visitor – entry not permitted${visitor.watchlist_reason ? ` (${visitor.watchlist_reason})` : ''}`;
    alerts.push({ level: 'danger', message: `RESTRICTED VISITOR: ${visitor.full_name} is on the restricted list. Entry is not permitted. Security has been alerted.` });
  } else if (needsApproval) {
    status = 'PENDING_APPROVAL';
  } else if (mode === 'PREREG' || isFuture) {
    status = 'EXPECTED';
  } else {
    status = 'APPROVED';
  }
  if (visitor.watchlist_status === 'FLAGGED') {
    alerts.push({ level: 'warning', message: `FLAGGED VISITOR: ${visitor.full_name} is flagged for attention${visitor.watchlist_reason ? ` – ${visitor.watchlist_reason}` : ''}. Security has been alerted.` });
  }

  const visitCode = (await client.query('SELECT next_document_number($1, $2) AS code', ['VST', localYear(tz)])).rows[0].code;
  const vehicleId = await upsertVehicle(client, input.vehicle, visitor.id);
  const consent = Boolean(input.consentGiven);
  const idVerified = Boolean(input.idVerified);

  const { rows } = await client.query(
    `INSERT INTO visits (visit_code, visitor_id, company_id, host_employee_id, department_id, host_name_snapshot, host_designation_snapshot,
                         purpose_id, purpose_other, category_id, access_area_id, appointment_type, appointment_date, expected_arrival,
                         expected_duration_min, appointment_reference, is_preregistered, special_instructions, qr_token, status, entry_point,
                         id_verified, id_verified_by, id_verified_at, verification_remarks,
                         consent_given, consent_at, consent_recorded_by, consent_text_version,
                         vehicle_id, driver_name, parking_required, vehicle_remarks, arrived_at, status_reason, remarks, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
             $22, CASE WHEN $22 THEN $33::int END, CASE WHEN $22 THEN now() END, $23,
             $24, CASE WHEN $24 THEN now() END, CASE WHEN $24 THEN $33::int END, CASE WHEN $24 THEN $25 END,
             $26, $27, $28, $29, $30, $31, $32, $33, $33)
     RETURNING id`,
    [
      visitCode, visitor.id, input.companyId !== undefined ? input.companyId : visitor.company_id, host.id, departmentId,
      `${host.salutation ? `${host.salutation} ` : ''}${host.full_name}`, host.designation,
      purpose.id, purpose.requires_specify ? input.purposeOther : (input.purposeOther || null), category.id, area?.id ?? null,
      mode === 'PREREG' ? 'PRE_REGISTERED' : (isFuture ? 'SCHEDULED' : (input.appointmentType || 'WALK_IN')),
      appointmentDate, input.expectedArrival || null, duration, input.appointmentReference || null,
      mode === 'PREREG', input.specialInstructions || null, newQrToken(), status, org.receptionPoint || null,
      idVerified, input.verificationRemarks || null,
      consent, visitorSettings.declarationVersion || '1.0',
      vehicleId, input.vehicle?.driverName || null, Boolean(input.vehicle?.parkingRequired), input.vehicle?.remarks || null,
      mode === 'WALK_IN' && !isFuture ? new Date() : null, statusReason, input.remarks || null, ctx.userId,
    ],
  );
  const visitId = rows[0].id;
  await recordStatus(client, visitId, null, mode === 'PREREG' ? 'EXPECTED' : 'REGISTERED', mode === 'PREREG' ? 'PRE_REGISTERED' : 'REGISTERED',
    mode === 'PREREG' ? 'Visit pre-registered' : 'Visitor registered at reception', ctx.userId);
  if (status !== 'EXPECTED') await recordStatus(client, visitId, null, status, status === 'DENIED' ? 'DENIED_RESTRICTED' : status, statusReason, ctx.userId);
  if (idVerified) await recordStatus(client, visitId, status, status, 'ID_VERIFIED', input.verificationRemarks || 'Identity document verified', ctx.userId);
  if (consent) await recordStatus(client, visitId, status, status, 'DECLARATION_ACCEPTED', `Declaration version ${visitorSettings.declarationVersion || '1.0'}`, ctx.userId);

  await audit(ctx, {
    action: mode === 'PREREG' ? 'VISIT_PREREGISTERED' : 'VISIT_CREATED', entityType: 'visit', entityId: visitId, entityRef: visitCode,
    summary: `${mode === 'PREREG' ? 'Pre-registered' : 'Registered'} visit for ${visitor.full_name} (${visitor.visitor_code}) to meet ${host.full_name}; status ${status}`,
    newValues: { visitorId: visitor.id, hostEmployeeId: host.id, purposeId: purpose.id, appointmentDate, status },
  }, client);

  const purposeLabel = input.purposeOther && purpose.requires_specify ? `${purpose.name} – ${input.purposeOther}` : purpose.name;
  if (status === 'PENDING_APPROVAL') {
    await client.query(
      'INSERT INTO approvals (visit_id, approver_employee_id, requested_by, reason) VALUES ($1, $2, $3, $4)',
      [visitId, host.id, ctx.userId, category.requires_approval ? `Category: ${category.name}` : area?.requires_approval ? `Access area: ${area.name}` : 'Walk-in approval policy'],
    );
    await recordStatus(client, visitId, status, status, 'APPROVAL_REQUESTED', `Approval requested from ${host.full_name}`, ctx.userId);
    await notifyHost(client, {
      hostEmployeeId: host.id, type: 'APPROVAL_REQUEST', visitId,
      title: `Approval required: ${visitor.full_name}`,
      body: `Visitor Approval Request\n\nVisitor: ${visitor.full_name}\nPurpose: ${purposeLabel}\nDate: ${appointmentDate}\nVisit Reference Number: ${visitCode}\n\nPlease approve or reject this request in the Visitor Management System.`,
      payload: { visitCode },
    });
  }
  if (visitor.watchlist_status !== 'NONE') {
    const alertSettings = (await getSetting('notification')).restrictedAlert || {};
    const roles = [...(alertSettings.security !== false ? ['SECURITY'] : []), ...(alertSettings.admin !== false ? ['ADMIN', 'SUPER_ADMIN'] : [])];
    await notifyRoles(client, roles, {
      type: 'RESTRICTED_VISITOR', visitId,
      title: `${visitor.watchlist_status === 'BLOCKED' ? 'Restricted' : 'Flagged'} visitor at ${org.receptionPoint || 'reception'}: ${visitor.full_name}`,
      body: `${visitor.watchlist_status === 'BLOCKED' ? 'A restricted (blocked) visitor attempted registration.' : 'A flagged visitor has been registered.'}\n\nVisitor: ${visitor.full_name} (${visitor.visitor_code})\nReason on record: ${visitor.watchlist_reason || '—'}\nHost requested: ${host.full_name}\nVisit Reference Number: ${visitCode}`,
      payload: { visitCode },
    });
    await audit(ctx, {
      action: 'RESTRICTED_VISITOR_ALERT', entityType: 'visit', entityId: visitId, entityRef: visitCode,
      summary: `${visitor.watchlist_status} visitor ${visitor.full_name} (${visitor.visitor_code}) – ${status === 'DENIED' ? 'entry denied' : 'alert raised'}`,
    }, client);
  }

  let checkedIn = false;
  if (checkIn && CHECK_IN_FROM.includes(status)) {
    await checkIn_(client, visitId, ctx, {});
    checkedIn = true;
  }
  return { visitId, visitCode, status: checkedIn ? 'CHECKED_IN' : status, alerts, needsApproval: status === 'PENDING_APPROVAL' };
}

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Check a visitor in: validates readiness, issues the visitor pass and notifies the host. */
async function checkIn_(client, visitId, ctx, extras) {
  const tz = await orgTimezone();
  const visitorSettings = await getSetting('visitor');
  const org = await getSetting('organisation');
  const visit = await lockVisit(client, visitId);

  if (ACTIVE_STATUSES.includes(visit.status)) throw conflict('This visitor is already checked in.');
  if (visit.status === 'PENDING_APPROVAL') throw conflict('This visit is awaiting host approval. The visitor cannot be checked in until the visit is approved.');
  if (!CHECK_IN_FROM.includes(visit.status)) {
    throw conflict(`This visit cannot be checked in because its status is ${STATUS_LABELS[visit.status]}.`);
  }
  if (visit.watchlist_status === 'BLOCKED') {
    await client.query(`UPDATE visits SET status = 'DENIED', status_reason = 'Restricted visitor – entry not permitted', updated_by = $2, row_version = row_version + 1 WHERE id = $1`, [visitId, ctx.userId]);
    await recordStatus(client, visitId, visit.status, 'DENIED', 'DENIED_RESTRICTED', 'Restricted visitor – check-in refused', ctx.userId);
    await audit(ctx, { action: 'RESTRICTED_VISITOR_ALERT', entityType: 'visit', entityId: visitId, entityRef: visit.visit_code, summary: `Check-in refused for restricted visitor ${visit.visitor_name}` }, client);
    return { denied: true };
  }

  // Readiness requirements configured by policy.
  const required = visitorSettings.requiredFields || {};
  const consent = visit.consent_given || Boolean(extras.consentGiven);
  const idVerified = visit.id_verified || Boolean(extras.idVerified);
  const fields = {};
  if (required.declaration && !consent) fields.consentGiven = 'The visitor declaration must be accepted before check-in';
  if (visit.category_requires_id && !idVerified) fields.idVerified = `Identity verification is required for ${visit.category_name} visitors`;
  if (required.photo && !visit.photo_file_id) fields.photo = 'A visitor photograph is required before check-in';
  if (Object.keys(fields).length) throw validationError(fields, 'The visitor cannot be checked in yet. Please complete the required items.');

  if (!visit.consent_given && extras.consentGiven) {
    await client.query('UPDATE visits SET consent_given = TRUE, consent_at = now(), consent_recorded_by = $2, consent_text_version = $3 WHERE id = $1',
      [visitId, ctx.userId, visitorSettings.declarationVersion || '1.0']);
    await recordStatus(client, visitId, visit.status, visit.status, 'DECLARATION_ACCEPTED', `Declaration version ${visitorSettings.declarationVersion || '1.0'}`, ctx.userId);
  }
  if (!visit.id_verified && extras.idVerified) {
    await client.query('UPDATE visits SET id_verified = TRUE, id_verified_by = $2, id_verified_at = now(), verification_remarks = coalesce($3, verification_remarks) WHERE id = $1',
      [visitId, ctx.userId, extras.verificationRemarks || null]);
    await recordStatus(client, visitId, visit.status, visit.status, 'ID_VERIFIED', extras.verificationRemarks || 'Identity document verified', ctx.userId);
  }

  const today = localDate(tz);
  const { rows } = await client.query(
    `UPDATE visits SET status = 'CHECKED_IN', check_in_at = now(), checked_in_by = $2, arrived_at = coalesce(arrived_at, now()),
            valid_until = now() + make_interval(mins => expected_duration_min), appointment_date = $3::date,
            access_area_id = coalesce($4, access_area_id), host_notified_at = now(), updated_by = $2, row_version = row_version + 1
      WHERE id = $1 RETURNING check_in_at, valid_until`,
    [visitId, ctx.userId, today, extras.accessAreaId || null],
  );
  const passNumber = (await client.query('SELECT next_document_number($1, $2) AS code', ['PASS', localYear(tz)])).rows[0].code;
  await client.query(
    'INSERT INTO visitor_passes (pass_number, visit_id, issued_by, valid_until) VALUES ($1, $2, $3, $4)',
    [passNumber, visitId, ctx.userId, rows[0].valid_until],
  );
  await recordStatus(client, visitId, visit.status, 'CHECKED_IN', 'CHECKED_IN', `Visitor Pass ${passNumber} issued`, ctx.userId);
  await refreshVisitorStats(client, visit.visitor_id);

  const { rows: info } = await client.query(
    `SELECT c.name AS company_name, p.name AS purpose_name, vi.purpose_other
       FROM visits vi LEFT JOIN companies c ON c.id = vi.company_id JOIN purposes p ON p.id = vi.purpose_id WHERE vi.id = $1`, [visitId],
  );
  await notifyHost(client, {
    hostEmployeeId: visit.host_employee_id, type: 'VISITOR_ARRIVAL', visitId,
    title: `Visitor arrived: ${visit.visitor_name}`,
    body: arrivalMessage({
      visitorName: visit.visitor_name,
      companyName: info[0].company_name,
      purpose: info[0].purpose_other ? `${info[0].purpose_name} – ${info[0].purpose_other}` : info[0].purpose_name,
      arrival: formatClock(tz, rows[0].check_in_at),
      receptionPoint: org.receptionPoint,
      passNumber,
    }),
    payload: { visitCode: visit.visit_code, passNumber },
  });
  await recordStatus(client, visitId, 'CHECKED_IN', 'CHECKED_IN', 'HOST_NOTIFIED', `Host ${visit.host_name_snapshot} notified of arrival`, null);
  await audit(ctx, {
    action: 'VISITOR_CHECKED_IN', entityType: 'visit', entityId: visitId, entityRef: visit.visit_code,
    summary: `${visit.visitor_name} checked in; Visitor Pass ${passNumber}`,
    newValues: { status: 'CHECKED_IN', passNumber, checkInAt: rows[0].check_in_at },
  }, client);
  return { passNumber };
}

export async function checkIn(client, visitId, ctx, extras = {}) {
  return checkIn_(client, visitId, ctx, extras);
}

export async function checkOut(client, visitId, ctx, { remarks } = {}) {
  const visit = await lockVisit(client, visitId);
  if (visit.status === 'CHECKED_OUT') throw conflict('This visitor has already been checked out.');
  if (!ACTIVE_STATUSES.includes(visit.status)) throw conflict(`This visitor is not checked in (current status: ${STATUS_LABELS[visit.status]}).`);
  const { rows } = await client.query(
    `UPDATE visits SET status = 'CHECKED_OUT', check_out_at = greatest(now(), check_in_at), checked_out_by = $2,
            duration_minutes = floor(extract(epoch FROM greatest(now(), check_in_at) - check_in_at) / 60)::int,
            closed_at = now(), remarks = CASE WHEN $3::text IS NULL THEN remarks ELSE concat_ws(E'\\n', remarks, $3::text) END,
            updated_by = $2, row_version = row_version + 1
      WHERE id = $1 RETURNING check_in_at, check_out_at, duration_minutes`,
    [visitId, ctx.userId, remarks || null],
  );
  await client.query(`UPDATE visitor_passes SET status = 'RETURNED', returned_at = now() WHERE visit_id = $1 AND status = 'ISSUED'`, [visitId]);
  await recordStatus(client, visitId, visit.status, 'CHECKED_OUT', 'CHECKED_OUT', remarks || null, ctx.userId);
  await recordStatus(client, visitId, 'CHECKED_OUT', 'CHECKED_OUT', 'VISIT_CLOSED', 'Visit record closed', ctx.userId);
  await refreshVisitorStats(client, visit.visitor_id);
  await audit(ctx, {
    action: 'VISITOR_CHECKED_OUT', entityType: 'visit', entityId: visitId, entityRef: visit.visit_code,
    summary: `${visit.visitor_name} checked out after ${rows[0].duration_minutes} minutes${visit.status === 'OVERSTAY' ? ' (overstay)' : ''}`,
    oldValues: { status: visit.status }, newValues: { status: 'CHECKED_OUT', checkOutAt: rows[0].check_out_at, durationMinutes: rows[0].duration_minutes },
  }, client);
  return rows[0];
}

export async function decideApproval(client, visitId, ctx, { decision, remarks }, { canApproveAny, employeeId }) {
  const visit = await lockVisit(client, visitId);
  if (!canApproveAny && visit.host_employee_id !== employeeId) throw forbidden('You can only approve visitors who are coming to meet you.');
  if (visit.status !== 'PENDING_APPROVAL') throw conflict('This visit is no longer awaiting approval.');
  const tz = await orgTimezone();
  const approved = decision === 'APPROVE';
  const today = localDate(tz);
  const newStatus = approved ? (visit.is_preregistered || visit.appointment_date > today ? 'EXPECTED' : 'APPROVED') : 'DENIED';
  await client.query(
    `UPDATE approvals SET decision = $2, decided_by = $3, decided_at = now(), remarks = $4 WHERE visit_id = $1 AND decision = 'PENDING'`,
    [visitId, approved ? 'APPROVED' : 'REJECTED', ctx.userId, remarks || null],
  );
  await client.query(
    `UPDATE visits SET status = $2, status_reason = $3, updated_by = $4, row_version = row_version + 1 WHERE id = $1`,
    [visitId, newStatus, approved ? null : (remarks || 'Rejected by host'), ctx.userId],
  );
  await recordStatus(client, visitId, 'PENDING_APPROVAL', newStatus, approved ? 'APPROVED' : 'REJECTED', remarks || null, ctx.userId);
  await audit(ctx, {
    action: approved ? 'VISIT_APPROVED' : 'VISIT_REJECTED', entityType: 'visit', entityId: visitId, entityRef: visit.visit_code,
    summary: `Visit ${visit.visit_code} for ${visit.visitor_name} ${approved ? 'approved' : 'rejected'}${remarks ? `: ${remarks}` : ''}`,
  }, client);
  await notifyRoles(client, ['RECEPTION'], {
    type: approved ? 'VISIT_APPROVED' : 'VISIT_REJECTED', visitId,
    title: `Visit ${approved ? 'approved' : 'rejected'}: ${visit.visitor_name}`,
    body: `The host has ${approved ? 'approved' : 'rejected'} visit ${visit.visit_code} for ${visit.visitor_name}.${remarks ? `\nRemarks: ${remarks}` : ''}`,
  });
  return { status: newStatus };
}

export async function cancelVisit(client, visitId, ctx, { reason }, { canViewAll, employeeId }) {
  const visit = await lockVisit(client, visitId);
  if (!canViewAll && visit.host_employee_id !== employeeId) throw forbidden();
  if (!CANCELLABLE.includes(visit.status)) throw conflict(`A visit with status ${STATUS_LABELS[visit.status]} cannot be cancelled.`);
  await client.query(`UPDATE visits SET status = 'CANCELLED', status_reason = $2, closed_at = now(), updated_by = $3, row_version = row_version + 1 WHERE id = $1`,
    [visitId, reason, ctx.userId]);
  await client.query(`UPDATE approvals SET decision = 'WITHDRAWN', decided_at = now(), decided_by = $2 WHERE visit_id = $1 AND decision = 'PENDING'`, [visitId, ctx.userId]);
  await recordStatus(client, visitId, visit.status, 'CANCELLED', 'CANCELLED', reason, ctx.userId);
  await audit(ctx, { action: 'VISIT_CANCELLED', entityType: 'visit', entityId: visitId, entityRef: visit.visit_code, summary: `Visit cancelled: ${reason}` }, client);
}

/** Record that a pass / visitor record was printed. */
export async function recordPrint(visitId, ctx, kind) {
  const { rows } = await query(
    `UPDATE visitor_passes SET print_count = print_count + 1, last_printed_at = now()
      WHERE visit_id = $1 AND status <> 'VOID' RETURNING pass_number, print_count`, [visitId],
  );
  const { rows: v } = await query('SELECT visit_code FROM visits WHERE id = $1', [visitId]);
  if (!v[0]) throw notFound('Visit record not found.');
  await audit(ctx, {
    action: kind === 'PASS' ? 'VISITOR_PASS_PRINTED' : 'VISITOR_RECORD_PRINTED', entityType: 'visit', entityId: visitId, entityRef: v[0].visit_code,
    summary: kind === 'PASS' ? `Visitor Pass ${rows[0]?.pass_number ?? ''} printed (copy ${rows[0]?.print_count ?? 1})` : 'Half-A4 Visitor Record printed',
  });
  if (rows[0] && kind === 'PASS') {
    await query(`INSERT INTO visit_status_history (visit_id, from_status, to_status, event, remarks, changed_by)
                 SELECT id, status, status, 'PASS_PRINTED', $2, $3 FROM visits WHERE id = $1`,
    [visitId, `Visitor Pass printed (copy ${rows[0].print_count})`, ctx.userId]);
  }
}

/**
 * Flag visitors who have exceeded their expected duration (plus grace).
 * Runs on a timer; a transaction-level advisory lock makes it safe when
 * several application instances run the job concurrently.
 */
export async function markOverstays(client) {
  const got = await client.query('SELECT pg_try_advisory_xact_lock(7263002) AS ok');
  if (!got.rows[0].ok) return [];
  const vs = await getSetting('visitor');
  const grace = Number(vs.overstayGraceMinutes) || 0;
  const { rows } = await client.query(
    `UPDATE visits vi SET status = 'OVERSTAY', overstay_flagged_at = now(), row_version = row_version + 1
       FROM visitors v
      WHERE v.id = vi.visitor_id AND vi.status = 'CHECKED_IN' AND vi.valid_until + make_interval(mins => $1) < now()
      RETURNING vi.id, vi.visit_code, vi.host_employee_id, vi.check_in_at, vi.valid_until, v.full_name`,
    [grace],
  );
  if (!rows.length) return rows;
  const ns = (await getSetting('notification')).overstay || {};
  const roles = [
    ...(ns.reception ? ['RECEPTION'] : []), ...(ns.security ? ['SECURITY'] : []), ...(ns.admin ? ['ADMIN', 'SUPER_ADMIN'] : []),
  ];
  const tz = await orgTimezone();
  for (const r of rows) {
    await recordStatus(client, r.id, 'CHECKED_IN', 'OVERSTAY', 'OVERSTAY', `Expected departure ${formatClock(tz, r.valid_until)} exceeded`, null);
    const msg = {
      type: 'OVERSTAY', visitId: r.id,
      title: `Overstay: ${r.full_name}`,
      body: `Visitor Overstay Alert\n\nVisitor: ${r.full_name}\nVisit Reference Number: ${r.visit_code}\nChecked in: ${formatClock(tz, r.check_in_at)}\nValid until: ${formatClock(tz, r.valid_until)}`,
    };
    await notifyRoles(client, roles, msg);
    if (ns.host) await notifyHost(client, { hostEmployeeId: r.host_employee_id, ...msg });
    await audit({ system: true }, { action: 'VISIT_OVERSTAY', entityType: 'visit', entityId: r.id, entityRef: r.visit_code, summary: `Overstay flagged for ${r.full_name}` }, client);
  }
  return rows;
}

export function assertCanView(req, visit, { canViewAll }) {
  if (canViewAll) return;
  if (req.user.employeeId && visit.host.id === req.user.employeeId) return;
  throw new AppError(404, 'NOT_FOUND', 'Visit record not found.');
}

import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { AppError, forbidden, notFound, validationError } from '../lib/errors.js';
import {
  parse, optText, optId, reqId, isoDate, optTime, vehicleNumber, bool, personName, countryCode, normaliseMobile, email, pageParams,
} from '../lib/validation.js';
import { localDate, addDays } from '../lib/time.js';
import { can, requirePermission } from '../middleware/auth.js';
import { audit, auditContext } from '../services/audit.js';
import { getSetting, orgTimezone } from '../services/settings.js';
import { dispatchPending } from '../services/notifications.js';
import { createVisitor, updateVisitor, findByMobile } from '../services/visitors.js';
import {
  createVisit, checkIn, checkOut, decideApproval, cancelVisit, getVisit, visitTimeline, recordPrint, assertCanView,
  VISIT_SELECT, VISIT_JOINS, shapeVisit,
} from '../services/visits.js';
import { parseVisitFilters, buildVisitWhere, orderBy } from '../services/visitQuery.js';
import { visitorFieldsSchema, validateVisitorFields } from './visitors.js';

export const visitsRouter = Router();

const vehicleSchema = z.object({
  registrationNumber: vehicleNumber,
  vehicleType: z.enum(['TWO_WHEELER', 'CAR', 'TAXI', 'BUS', 'COMMERCIAL', 'OTHER']).optional().or(z.literal('').transform(() => undefined)),
  driverName: optText(100),
  parkingRequired: bool,
  remarks: optText(200),
}).optional();

export const visitInputSchema = z.object({
  hostEmployeeId: reqId('Host / Officer to be Met'),
  departmentId: optId,
  purposeId: reqId('Purpose of Visit'),
  purposeOther: optText(150),
  categoryId: optId,
  accessAreaId: optId,
  appointmentType: z.enum(['WALK_IN', 'SCHEDULED', 'PRE_REGISTERED']).optional(),
  appointmentDate: isoDate('Appointment Date').optional(),
  expectedArrival: optTime,
  expectedDurationMin: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(5, 'Expected Duration must be at least 5 minutes').max(1440).optional()),
  appointmentReference: optText(50),
  specialInstructions: optText(500),
  idVerified: bool,
  verificationRemarks: optText(200),
  consentGiven: bool,
  vehicle: vehicleSchema,
  remarks: optText(500),
});

async function validateVisitRequired(visit, { forCheckIn, requireCategory = true }) {
  const required = (await getSetting('visitor')).requiredFields || {};
  const fields = {};
  if (requireCategory && required.category && !visit.categoryId) fields.categoryId = 'Visitor Category is required';
  if (required.accessArea && !visit.accessAreaId) fields.accessAreaId = 'Access Area is required';
  if (forCheckIn && required.declaration && !visit.consentGiven) fields.consentGiven = 'The visitor declaration must be accepted';
  if (visit.vehicle && !visit.vehicle.registrationNumber && (visit.vehicle.driverName || visit.vehicle.parkingRequired)) {
    fields['vehicle.registrationNumber'] = 'Enter the vehicle registration number';
  }
  if (Object.keys(fields).length) throw validationError(fields);
}

function hostScope(req) {
  if (can(req, 'visit.view_all')) return null;
  if (can(req, 'visit.view_own') && req.user.employeeId) return req.user.employeeId;
  throw forbidden();
}

function afterCommit() {
  // Deliver queued e-mail / SMS notifications without delaying the response.
  dispatchPending().catch((err) => console.error('[notify] dispatch failed', err.message));
}

// POST /api/visits — Visitor Registration (new or existing visitor) with optional immediate check-in.
visitsRouter.post('/', requirePermission('visit.create'), async (req, res) => {
  const body = parse(z.object({
    visitorId: optId,
    visitor: z.record(z.string(), z.unknown()).optional(),
    visit: z.record(z.string(), z.unknown()),
    checkIn: z.boolean().optional(),
  }), req.body);
  if (!body.visitorId && !can(req, 'visitor.create')) throw forbidden();
  // Validate visitor and visit sections together so every problem is reported at once.
  const fields = {};
  const collect = async (fn) => {
    try { return await fn(); } catch (err) {
      if (err.code === 'VALIDATION_FAILED' && err.fields) { Object.assign(fields, err.fields); return null; }
      throw err;
    }
  };
  const visitorInput = await collect(async () => {
    const v = parse(body.visitorId ? visitorFieldsSchema.partial() : visitorFieldsSchema, body.visitor || {});
    await validateVisitorFields(v, { partial: Boolean(body.visitorId) });
    return v;
  });
  const visitInput = await collect(async () => {
    const v = parse(visitInputSchema, body.visit);
    await validateVisitRequired(v, { forCheckIn: Boolean(body.checkIn) });
    return v;
  });
  if (Object.keys(fields).length) throw validationError(fields);
  if (body.visitorId && Object.keys(visitorInput).some((k) => visitorInput[k] !== undefined) && !can(req, 'visitor.update')) {
    throw forbidden('You do not have permission to change visitor information.');
  }
  if (body.checkIn && !can(req, 'visit.checkin')) throw forbidden('You do not have permission to check visitors in.');

  const ctx = auditContext(req);
  const result = await withTransaction(async (client) => {
    let visitorId = body.visitorId;
    let visitorCreated = false;
    if (visitorId) {
      await updateVisitor(client, visitorId, visitorInput, ctx, { canCreateCompany: can(req, 'company.create') });
    } else {
      const created = await createVisitor(client, visitorInput, ctx, { canCreateCompany: can(req, 'company.create') });
      visitorId = created.id;
      visitorCreated = true;
    }
    const { rows } = await client.query('SELECT company_id FROM visitors WHERE id = $1', [visitorId]);
    const visit = await createVisit(client, { ...visitInput, visitorId, companyId: rows[0].company_id }, ctx, { mode: 'WALK_IN', checkIn: Boolean(body.checkIn) });
    return { ...visit, visitorId, visitorCreated };
  });
  afterCommit();
  const visit = await getVisit(result.visitId);
  let message;
  if (result.status === 'CHECKED_IN') message = 'Visitor registration completed successfully. Visitor successfully checked in.';
  else if (result.status === 'DENIED') message = 'Entry denied: this visitor is on the restricted list.';
  else if (result.status === 'PENDING_APPROVAL') message = 'Visitor registration completed successfully. The visit is awaiting host approval.';
  else message = 'Visitor registration completed successfully.';
  res.status(201).json({ visit, alerts: result.alerts, message, visitorCreated: result.visitorCreated });
});

// POST /api/visits/pre-registration — expected visitor registered in advance (also mounted at /api/pre-registration).
export async function preRegister(req, res) {
  if (!can(req, 'prereg.any') && !can(req, 'prereg.own')) throw forbidden();
  const body = parse(z.object({
    visitorId: optId,
    visitor: z.object({
      fullName: personName('Visitor Name'),
      mobileCountryCode: countryCode.default('+91'),
      mobileNumber: z.preprocess(normaliseMobile, z.string({ error: 'Mobile Number is required' }).min(1, 'Mobile Number is required')),
      email,
      companyId: optId,
      newCompanyName: optText(150),
      designation: optText(100),
    }),
    visit: z.record(z.string(), z.unknown()),
  }), req.body);
  const visitInput = parse(visitInputSchema, body.visit);
  await validateVisitorFields(body.visitor, { partial: true });
  if (!visitInput.appointmentDate) throw validationError({ appointmentDate: 'Appointment Date is required' });
  const isHostOnly = !can(req, 'prereg.any');
  if (isHostOnly) {
    if (!req.user.employeeId) throw forbidden('Your account is not linked to an employee record.');
    visitInput.hostEmployeeId = req.user.employeeId;
  }
  // The category may be left blank at pre-registration; it defaults to Guest and is confirmed at check-in.
  await validateVisitRequired(visitInput, { forCheckIn: false, requireCategory: false });
  const ctx = auditContext(req);
  const result = await withTransaction(async (client) => {
    let visitorId = can(req, 'visitor.view') ? body.visitorId : null;
    if (!visitorId) {
      const matches = await findByMobile(body.visitor.mobileCountryCode, body.visitor.mobileNumber, client);
      const same = matches.find((m) => m.fullName.toLowerCase().replace(/\s+/g, ' ') === body.visitor.fullName.toLowerCase());
      if (same) {
        visitorId = same.id;
      } else {
        const created = await createVisitor(client, {
          ...body.visitor,
          duplicateOverrideReason: matches.length ? 'Pre-registration: different name on an already registered mobile number' : undefined,
        }, ctx, { canCreateCompany: can(req, 'company.create') });
        visitorId = created.id;
      }
    }
    const { rows } = await client.query('SELECT company_id FROM visitors WHERE id = $1', [visitorId]);
    return createVisit(client, { ...visitInput, visitorId, companyId: rows[0].company_id }, ctx, { mode: 'PREREG', createdByHost: isHostOnly });
  });
  afterCommit();
  const visit = await getVisit(result.visitId);
  res.status(201).json({
    visit,
    alerts: result.alerts,
    message: `Pre-registration completed successfully. Visit Reference Number: ${visit.visitCode}`,
  });
}
visitsRouter.post('/pre-registration', preRegister);

// GET /api/visits — Visitor Search & History
visitsRouter.get('/', requirePermission('visit.view_all', 'visit.view_own'), async (req, res) => {
  const f = parseVisitFilters(req.query);
  const { page, pageSize } = parse(pageParams, req.query);
  const { sort, dir } = parse(z.object({ sort: z.string().max(30).optional(), dir: z.enum(['asc', 'desc']).optional() }), req.query);
  const { where, params } = buildVisitWhere(f, { hostScopeEmployeeId: hostScope(req) });
  const n = params.length;
  const { rows } = await query(
    `SELECT ${VISIT_SELECT}, count(*) OVER () AS total_count ${VISIT_JOINS}
      WHERE ${where} ORDER BY ${orderBy(sort, dir)} LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({ items: rows.map(shapeVisit), total: rows[0]?.total_count ?? 0, page, pageSize });
});

// GET /api/visits/current — visitors currently on premises
visitsRouter.get('/current', requirePermission('onpremises.view'), async (_req, res) => {
  const { rows } = await query(
    `SELECT ${VISIT_SELECT} ${VISIT_JOINS} WHERE vi.status IN ('CHECKED_IN', 'OVERSTAY') ORDER BY vi.check_in_at`,
  );
  res.json({ items: rows.map(shapeVisit), generatedAt: new Date().toISOString() });
});

// GET /api/visits/lookup?q=&mode=checkin|checkout — operational search for the check-in / check-out desks
visitsRouter.get('/lookup', requirePermission('visit.checkin', 'visit.checkout'), async (req, res) => {
  const { q, mode } = parse(z.object({ q: z.string().max(200).default(''), mode: z.enum(['checkin', 'checkout']) }), req.query);
  const tz = await orgTimezone();
  const today = localDate(tz);
  const params = [];
  const clauses = [];
  if (mode === 'checkin') {
    clauses.push(`vi.status IN ('EXPECTED', 'APPROVED', 'PENDING_APPROVAL')`);
    params.push(addDays(today, -1), addDays(today, 30), today);
    clauses.push('vi.appointment_date BETWEEN $1::date AND $2::date');
  } else {
    clauses.push(`vi.status IN ('CHECKED_IN', 'OVERSTAY')`);
  }
  const term = q.trim();
  if (term) {
    const token = term.match(/verify\/([A-Za-z0-9_-]{20,64})/)?.[1] || (/^[A-Za-z0-9_-]{32}$/.test(term) && /\d/.test(term) && /[A-Za-z]/.test(term) ? term : null);
    const digits = term.replace(/[\s\-+()]/g, '');
    if (token) {
      params.push(token);
      clauses.push(`vi.qr_token = $${params.length}`);
    } else if (/^(VST|PASS|VIS)-/i.test(term)) {
      params.push(term.toUpperCase());
      clauses.push(`(vi.visit_code = $${params.length} OR pass.pass_number = $${params.length} OR v.visitor_code = $${params.length})`);
    } else if (/^\d{3,15}$/.test(digits)) {
      params.push(digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits);
      clauses.push(`v.mobile_number LIKE '%' || $${params.length} || '%'`);
    } else {
      params.push(term);
      clauses.push(`(v.full_name ILIKE '%' || $${params.length} || '%' OR c.name ILIKE '%' || $${params.length} || '%' OR vi.host_name_snapshot ILIKE '%' || $${params.length} || '%')`);
    }
  }
  const { rows } = await query(
    `SELECT ${VISIT_SELECT} ${VISIT_JOINS} WHERE ${clauses.join(' AND ')}
      ORDER BY ${mode === 'checkin' ? 'abs(vi.appointment_date - $3::date), vi.expected_arrival NULLS LAST' : 'vi.check_in_at'}, vi.id LIMIT 50`,
    params,
  );
  res.json({ items: rows.map(shapeVisit) });
});

// GET /api/visits/:id — Visitor Visit Details (id, visit code, pass number)
visitsRouter.get('/:key', requirePermission('visit.view_all', 'visit.view_own'), async (req, res) => {
  const visit = await getVisit(req.params.key);
  assertCanView(req, visit, { canViewAll: can(req, 'visit.view_all') });
  const timeline = await visitTimeline(visit.id);
  const { rows: approvals } = await query(
    `SELECT a.decision, a.reason, a.requested_at, a.decided_at, a.remarks, u.full_name AS decided_by_name
       FROM approvals a LEFT JOIN users u ON u.id = a.decided_by WHERE a.visit_id = $1 ORDER BY a.requested_at`, [visit.id],
  );
  const { rows: notifications } = await query(
    `SELECT channel, type, status, status_detail, created_at, sent_at, read_at FROM notifications
      WHERE visit_id = $1 AND (recipient_employee_id IS NOT NULL) ORDER BY created_at`, [visit.id],
  );
  await audit(auditContext(req), { action: 'VISIT_VIEWED', entityType: 'visit', entityId: visit.id, entityRef: visit.visitCode, summary: `Visit record viewed: ${visit.visitor.fullName}` });
  res.json({ visit, timeline, approvals, notifications });
});

// POST /api/visits/:id/check-in
visitsRouter.post('/:id/check-in', requirePermission('visit.checkin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound('Visit record not found.');
  const extras = parse(z.object({ idVerified: bool, verificationRemarks: optText(200), consentGiven: bool, accessAreaId: optId }), req.body);
  const ctx = auditContext(req);
  const result = await withTransaction((client) => checkIn(client, id, ctx, extras));
  afterCommit();
  const visit = await getVisit(id);
  if (result?.denied) {
    return res.status(403).json({ error: { code: 'RESTRICTED_VISITOR', message: 'Entry denied: this visitor is on the restricted list. Security has been alerted.' }, visit });
  }
  res.json({ visit, message: 'Visitor successfully checked in.' });
});

// POST /api/visits/:id/check-out
visitsRouter.post('/:id/check-out', requirePermission('visit.checkout'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound('Visit record not found.');
  const { remarks } = parse(z.object({ remarks: optText(300) }), req.body);
  const ctx = auditContext(req);
  await withTransaction((client) => checkOut(client, id, ctx, { remarks }));
  res.json({ visit: await getVisit(id), message: 'Visitor check-out has been recorded successfully.' });
});

// POST /api/visits/:id/decision — approve / reject
visitsRouter.post('/:id/decision', requirePermission('visit.approve_own', 'visit.approve_any'), async (req, res) => {
  const id = Number(req.params.id);
  const body = parse(z.object({ decision: z.enum(['APPROVE', 'REJECT'], { error: 'Select Approve or Reject' }), remarks: optText(300) }), req.body);
  if (body.decision === 'REJECT' && !body.remarks) throw validationError({ remarks: 'Please state the reason for rejection' });
  const ctx = auditContext(req);
  const result = await withTransaction((client) => decideApproval(client, id, ctx, body, {
    canApproveAny: can(req, 'visit.approve_any'), employeeId: req.user.employeeId,
  }));
  res.json({ visit: await getVisit(id), status: result.status, message: body.decision === 'APPROVE' ? 'The visit has been approved.' : 'The visit request has been rejected.' });
});

// POST /api/visits/:id/cancel
visitsRouter.post('/:id/cancel', requirePermission('visit.cancel', 'prereg.own'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = parse(z.object({ reason: z.string({ error: 'Reason is required' }).trim().min(3, 'Please state the reason for cancellation').max(300) }), req.body);
  const ctx = auditContext(req);
  await withTransaction((client) => cancelVisit(client, id, ctx, { reason }, { canViewAll: can(req, 'visit.cancel'), employeeId: req.user.employeeId }));
  res.json({ visit: await getVisit(id), message: 'The visit has been cancelled.' });
});

// POST /api/visits/:id/print — audit a pass / record print
visitsRouter.post('/:id/print', requirePermission('pass.print'), async (req, res) => {
  const id = Number(req.params.id);
  const { kind } = parse(z.object({ kind: z.enum(['PASS', 'RECORD']) }), req.body);
  await recordPrint(id, auditContext(req), kind);
  res.json({ ok: true });
});

// GET /api/visits/:id/qr.svg — QR code containing only an opaque random token (no personal data)
visitsRouter.get('/:id/qr.svg', requirePermission('visit.view_all', 'visit.view_own', 'pass.print'), async (req, res) => {
  const visit = await getVisit(req.params.id);
  if (!can(req, 'pass.print')) assertCanView(req, visit, { canViewAll: can(req, 'visit.view_all') });
  const svg = await QRCode.toString(`${config.publicBaseUrl}/verify/${visit.qrToken}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  res.set('Cache-Control', 'private, max-age=300').type('image/svg+xml').send(svg);
});

// GET /api/verify/:token — security verification of a pass / QR code
export async function verifyToken(req, res) {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) && !/^(PASS|VST)-\d{4}-\d{6}$/i.test(token)) throw notFound('This pass or QR code is not recognised.');
  let visit;
  try {
    visit = await getVisit(token);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) {
      await audit(auditContext(req), { action: 'PASS_VERIFICATION_FAILED', entityType: 'visit', summary: 'Unrecognised pass / QR code presented' });
      throw notFound('This pass or QR code is not recognised. Please verify the visitor manually.');
    }
    throw err;
  }
  const now = Date.now();
  let verdict;
  if (visit.status === 'CHECKED_IN') verdict = { valid: true, level: 'success', message: 'Valid visitor pass. The visitor is checked in.' };
  else if (visit.status === 'OVERSTAY') verdict = { valid: true, level: 'warning', message: 'Pass valid, but the visitor has exceeded the permitted duration (OVERSTAY).' };
  else if (['EXPECTED', 'APPROVED'].includes(visit.status)) verdict = { valid: false, level: 'info', message: 'Expected visitor – not yet checked in. Direct the visitor to reception.' };
  else if (visit.status === 'PENDING_APPROVAL') verdict = { valid: false, level: 'warning', message: 'Visit awaiting host approval. Entry not yet permitted.' };
  else if (visit.status === 'CHECKED_OUT') verdict = { valid: false, level: 'danger', message: 'This pass is no longer valid – the visitor has already checked out.' };
  else verdict = { valid: false, level: 'danger', message: `This visit is ${visit.statusLabel}. Entry not permitted.` };
  if (visit.visitor.watchlistStatus === 'BLOCKED') verdict = { valid: false, level: 'danger', message: 'RESTRICTED VISITOR – entry not permitted. Alert the security supervisor.' };
  await audit(auditContext(req), { action: 'PASS_VERIFIED', entityType: 'visit', entityId: visit.id, entityRef: visit.visitCode, summary: `Pass verified: ${verdict.message}` });
  res.json({ visit, verdict, checkedAt: new Date(now).toISOString() });
}

// GET /api/approvals — pending / decided approval requests
export async function listApprovals(req, res) {
  const { status } = parse(z.object({ status: z.enum(['PENDING', 'DECIDED']).default('PENDING') }), req.query);
  const scope = can(req, 'visit.approve_any') ? null : req.user.employeeId;
  if (scope === null && !can(req, 'visit.approve_any')) throw forbidden();
  if (!can(req, 'visit.approve_any') && !req.user.employeeId) return res.json({ items: [] });
  const params = [];
  let where = status === 'PENDING' ? `vi.status = 'PENDING_APPROVAL'` : `EXISTS (SELECT 1 FROM approvals a WHERE a.visit_id = vi.id AND a.decision IN ('APPROVED','REJECTED'))`;
  if (scope) { params.push(scope); where += ` AND vi.host_employee_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT ${VISIT_SELECT} ${VISIT_JOINS} WHERE ${where} ORDER BY vi.appointment_date ${status === 'PENDING' ? 'ASC' : 'DESC'}, vi.created_at DESC LIMIT 200`, params,
  );
  res.json({ items: rows.map(shapeVisit) });
}

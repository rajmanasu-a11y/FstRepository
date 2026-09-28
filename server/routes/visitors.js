import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { validationError, notFound, forbidden } from '../lib/errors.js';
import {
  parse, optText, optId, personName, countryCode, normaliseMobile, mobileProblem, email, pageParams,
} from '../lib/validation.js';
import { can, requirePermission } from '../middleware/auth.js';
import { audit, auditContext } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { storeVisitorPhoto } from '../services/files.js';
import {
  createVisitor, findByMobile, getVisitor, searchVisitors, updateVisitor, maskReference,
} from '../services/visitors.js';
import { VISIT_JOINS, VISIT_SELECT, shapeVisit } from '../services/visits.js';

export const visitorsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const err = new Error('type');
      err.status = 415;
      return cb(Object.assign(err, { appMessage: true }));
    }
    cb(null, true);
  },
});

/** Visitor master fields shared by create / update / composite registration. */
export const visitorFieldsSchema = z.object({
  fullName: personName('Visitor Name'),
  mobileCountryCode: countryCode.default('+91'),
  mobileNumber: z.preprocess(normaliseMobile, z.string({ error: 'Mobile Number is required' }).min(1, 'Mobile Number is required').max(15)),
  alternateContact: z.preprocess((v) => (typeof v === 'string' ? v.replace(/[^\d+]/g, '') : v), optText(20)),
  email,
  companyId: optId,
  newCompanyName: optText(150),
  designation: optText(100),
  address: optText(300),
  idTypeId: optId,
  idReference: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), optText(40))
    .refine((v) => v == null || /^[A-Z0-9\-/ ]{3,40}$/.test(v), 'Enter a valid ID / reference number'),
  photoFileId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  duplicateOverrideReason: optText(200),
});

/** Cross-field validation against configurable required fields. */
export async function validateVisitorFields(v, { partial = false } = {}) {
  const fields = {};
  if (v.mobileNumber !== undefined) {
    const problem = mobileProblem(v.mobileCountryCode || '+91', v.mobileNumber);
    if (problem) fields.mobileNumber = problem;
  }
  const required = (await getSetting('visitor')).requiredFields || {};
  if (!partial) {
    if (required.company && !v.companyId && !v.newCompanyName) fields.companyId = 'Organisation / Company is required';
    if (required.email && !v.email) fields.email = 'Email Address is required';
    if (required.designation && !v.designation) fields.designation = 'Designation is required';
    if (required.idType && !v.idTypeId) fields.idTypeId = 'ID Type is required';
    if (required.idNumber && !v.idReference) fields.idReference = 'ID Number / Reference Number is required';
    if (required.photo && !v.photoFileId) fields.photo = 'Visitor photograph is required';
  }
  if (v.idReference && !v.idTypeId && !partial) fields.idTypeId = 'Select the ID Type for this reference number';
  if (Object.keys(fields).length) throw validationError(fields);
}

function scopeVisitor(req, visitor) {
  const vs = req.visitorSettings;
  // Mask the ID reference for roles that cannot update visitor records.
  if (!can(req, 'visitor.update') && visitor.idReference && vs?.idNumberStorage === 'FULL') {
    visitor.idReference = maskReference(visitor.idReference);
  }
  return visitor;
}

// GET /api/visitors/search?q=  — fast returning-visitor search
visitorsRouter.get('/search', requirePermission('visitor.view'), async (req, res) => {
  const { q, limit, offset } = parse(z.object({
    q: z.string().max(100).default(''),
    limit: z.coerce.number().int().min(1).max(50).default(8),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  }), req.query);
  const result = await searchVisitors(q, { limit, offset });
  req.visitorSettings = await getSetting('visitor');
  res.json({ items: result.items.map((v) => scopeVisitor(req, v)), total: result.total, query: q });
});

// GET /api/visitors/check-duplicate?mobileCountryCode=&mobileNumber=
visitorsRouter.get('/check-duplicate', requirePermission('visitor.create'), async (req, res) => {
  const { mobileCountryCode, mobileNumber } = parse(z.object({
    mobileCountryCode: countryCode.default('+91'),
    mobileNumber: z.preprocess(normaliseMobile, z.string().regex(/^\d{6,14}$/, 'Enter a valid mobile number')),
  }), req.query);
  res.json({ matches: await findByMobile(mobileCountryCode, mobileNumber) });
});

// GET /api/visitors  — paginated master list (restricted visitor management uses ?watchlist=true)
visitorsRouter.get('/', requirePermission('visitor.view'), async (req, res) => {
  const f = parse(pageParams.extend({
    q: z.string().max(100).optional(),
    watchlist: z.enum(['true', 'false']).optional(),
    recordStatus: z.enum(['ACTIVE', 'ARCHIVED', 'ANONYMISED']).optional(),
  }), req.query);
  const params = [];
  const where = [];
  if (f.watchlist === 'true') where.push(`v.watchlist_status <> 'NONE'`);
  if (f.recordStatus) { params.push(f.recordStatus); where.push(`v.record_status = $${params.length}`); }
  if (f.q) {
    params.push(f.q);
    where.push(`(v.full_name ILIKE '%' || $${params.length} || '%' OR v.mobile_number LIKE '%' || $${params.length} || '%' OR c.name ILIKE '%' || $${params.length} || '%' OR v.visitor_code = upper($${params.length}))`);
  }
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await query(
    `SELECT v.id, v.visitor_code, v.full_name, v.mobile_country_code, v.mobile_number, v.email::text AS email, c.name AS company_name,
            v.designation, v.watchlist_status, v.watchlist_reason, v.watchlist_updated_at, v.record_status, v.total_visits,
            v.last_visit_at, v.photo_file_id, count(*) OVER () AS total_count
       FROM visitors v LEFT JOIN companies c ON c.id = v.company_id
      WHERE ${where.length ? where.join(' AND ') : 'TRUE'}
      ORDER BY v.last_visit_at DESC NULLS LAST, v.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id, visitorCode: r.visitor_code, fullName: r.full_name, mobileCountryCode: r.mobile_country_code, mobileNumber: r.mobile_number,
      email: r.email, companyName: r.company_name, designation: r.designation, watchlistStatus: r.watchlist_status,
      watchlistReason: r.watchlist_reason, watchlistUpdatedAt: r.watchlist_updated_at, recordStatus: r.record_status,
      totalVisits: r.total_visits, lastVisitAt: r.last_visit_at, photoUrl: r.photo_file_id ? `/api/files/photos/${r.photo_file_id}` : null,
    })),
    total: rows[0]?.total_count ?? 0, page: f.page, pageSize: f.pageSize,
  });
});

// POST /api/visitors  — create visitor master only
visitorsRouter.post('/', requirePermission('visitor.create'), async (req, res) => {
  const input = parse(visitorFieldsSchema, req.body);
  await validateVisitorFields(input);
  const ctx = auditContext(req);
  const created = await withTransaction((client) => createVisitor(client, input, ctx, { canCreateCompany: can(req, 'company.create') }));
  res.status(201).json({ visitor: await getVisitor(created.id), message: 'Visitor information has been saved successfully.' });
});

// GET /api/visitors/:id  — consolidated visitor profile
visitorsRouter.get('/:id', requirePermission('visitor.view'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound('Visitor record not found.');
  const visitor = await getVisitor(id);
  req.visitorSettings = await getSetting('visitor');
  const { rows: stats } = await query(
    `SELECT count(*) FILTER (WHERE check_in_at IS NOT NULL) AS visits, avg(duration_minutes)::int AS avg_duration,
            count(*) FILTER (WHERE status = 'OVERSTAY' OR overstay_flagged_at IS NOT NULL) AS overstays,
            count(DISTINCT host_employee_id) AS hosts
       FROM visits WHERE visitor_id = $1`, [id],
  );
  await audit(auditContext(req), { action: 'VISITOR_VIEWED', entityType: 'visitor', entityId: id, entityRef: visitor.visitorCode, summary: `Visitor profile viewed: ${visitor.fullName}` });
  res.json({
    visitor: scopeVisitor(req, visitor),
    stats: { totalVisits: stats[0].visits, averageDurationMinutes: stats[0].avg_duration, overstays: stats[0].overstays, distinctHosts: stats[0].hosts },
  });
});

// GET /api/visitors/:id/visits — visit history
visitorsRouter.get('/:id/visits', requirePermission('visitor.view'), async (req, res) => {
  const id = Number(req.params.id);
  const f = parse(pageParams, req.query);
  const { rows } = await query(
    `SELECT ${VISIT_SELECT}, count(*) OVER () AS total_count ${VISIT_JOINS}
      WHERE vi.visitor_id = $1
      ORDER BY coalesce(vi.check_in_at, vi.created_at) DESC, vi.id DESC LIMIT $2 OFFSET $3`,
    [id, f.pageSize, (f.page - 1) * f.pageSize],
  );
  res.json({ items: rows.map(shapeVisit), total: rows[0]?.total_count ?? 0, page: f.page, pageSize: f.pageSize });
});

// PUT /api/visitors/:id — update master information
visitorsRouter.put('/:id', requirePermission('visitor.update'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound('Visitor record not found.');
  const input = parse(visitorFieldsSchema.partial(), req.body);
  await validateVisitorFields({ ...input, mobileCountryCode: input.mobileCountryCode }, { partial: true });
  const ctx = auditContext(req);
  await withTransaction((client) => updateVisitor(client, id, input, ctx, { canCreateCompany: can(req, 'company.create') }));
  res.json({ visitor: await getVisitor(id), message: 'Visitor information has been saved successfully.' });
});

// PUT /api/visitors/:id/watchlist — manage blocked / restricted visitors
visitorsRouter.put('/:id/watchlist', requirePermission('visitor.watchlist'), async (req, res) => {
  const id = Number(req.params.id);
  const body = parse(z.object({
    status: z.enum(['NONE', 'FLAGGED', 'BLOCKED']),
    reason: optText(300),
  }), req.body);
  if (body.status !== 'NONE' && !body.reason) throw validationError({ reason: 'A reason is required when restricting a visitor' });
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT visitor_code, full_name, watchlist_status, watchlist_reason FROM visitors WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Visitor record not found.');
    await client.query(
      `UPDATE visitors SET watchlist_status = $2, watchlist_reason = $3, watchlist_updated_by = $4, watchlist_updated_at = now(), updated_by = $4 WHERE id = $1`,
      [id, body.status, body.status === 'NONE' ? null : body.reason, ctx.userId],
    );
    await audit(ctx, {
      action: 'VISITOR_WATCHLIST_CHANGED', entityType: 'visitor', entityId: id, entityRef: rows[0].visitor_code,
      summary: `Restriction for ${rows[0].full_name} changed from ${rows[0].watchlist_status} to ${body.status}`,
      oldValues: { status: rows[0].watchlist_status, reason: rows[0].watchlist_reason }, newValues: { status: body.status, reason: body.reason ?? null },
    }, client);
  });
  res.json({ visitor: await getVisitor(id), message: 'Visitor restriction status has been updated successfully.' });
});

// POST /api/visitors/:id/archive  and /restore
visitorsRouter.post('/:id/archive', requirePermission('visitor.archive'), async (req, res) => {
  const id = Number(req.params.id);
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT visitor_code, full_name, record_status FROM visitors WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Visitor record not found.');
    const active = await client.query(`SELECT 1 FROM visits WHERE visitor_id = $1 AND status IN ('CHECKED_IN','OVERSTAY','EXPECTED','PENDING_APPROVAL','APPROVED')`, [id]);
    if (active.rows[0]) throw validationError({}, 'This visitor has an open or upcoming visit and cannot be archived.');
    await client.query(`UPDATE visitors SET record_status = 'ARCHIVED', archived_at = now(), updated_by = $2 WHERE id = $1 AND record_status = 'ACTIVE'`, [id, ctx.userId]);
    await audit(ctx, { action: 'VISITOR_ARCHIVED', entityType: 'visitor', entityId: id, entityRef: rows[0].visitor_code, summary: `Visitor archived: ${rows[0].full_name}` }, client);
  });
  res.json({ message: 'The visitor record has been archived.' });
});

visitorsRouter.post('/:id/restore', requirePermission('visitor.archive'), async (req, res) => {
  const id = Number(req.params.id);
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT visitor_code, full_name FROM visitors WHERE id = $1 AND record_status = $2 FOR UPDATE', [id, 'ARCHIVED']);
    if (!rows[0]) throw notFound('Archived visitor record not found.');
    await client.query(`UPDATE visitors SET record_status = 'ACTIVE', archived_at = NULL, updated_by = $2 WHERE id = $1`, [id, ctx.userId]);
    await audit(ctx, { action: 'VISITOR_RESTORED', entityType: 'visitor', entityId: id, entityRef: rows[0].visitor_code, summary: `Visitor restored: ${rows[0].full_name}` }, client);
  });
  res.json({ message: 'The visitor record has been restored.' });
});

// POST /api/photos — upload / capture a photograph (returns a file id to attach)
export const photoUploadHandler = [
  (req, res, next) => {
    if (!can(req, 'visitor.create') && !can(req, 'visitor.update')) return next(forbidden());
    upload.single('photo')(req, res, (err) => {
      if (err?.appMessage) return next(validationTypeError());
      next(err);
    });
  },
  async (req, res) => {
    if (!req.file) throw validationError({ photo: 'Please choose a photograph to upload' });
    const stored = await storeVisitorPhoto(req.file.buffer, { originalName: req.file.originalname, userId: req.user.id });
    res.status(201).json({ fileId: stored.id, url: `/api/files/photos/${stored.id}`, sizeBytes: stored.size_bytes, width: stored.width, height: stored.height });
  },
];

function validationTypeError() {
  const err = validationError({ photo: 'Only JPEG, PNG or WebP images are accepted.' }, 'Only JPEG, PNG or WebP images are accepted.');
  err.status = 415;
  err.code = 'UNSUPPORTED_FILE';
  return err;
}

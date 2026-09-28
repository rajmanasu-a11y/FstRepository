import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { notFound, validationError } from '../lib/errors.js';
import { parse, optText, reqText, reqId, email, bool, pageParams, personName } from '../lib/validation.js';
import { requirePermission, requireAuth } from '../middleware/auth.js';
import { audit, auditContext, diff } from '../services/audit.js';

// =============================================================================
// Employee / Host Directory
// =============================================================================
export const employeesRouter = Router();

const employeeSchema = z.object({
  employeeCode: reqText('Employee ID', 30).regex(/^[A-Za-z0-9\-/]+$/, 'Employee ID may contain letters, digits, - and / only'),
  salutation: z.enum(['Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.', 'Shri', 'Smt.']).nullable().optional().or(z.literal('').transform(() => null)),
  fullName: personName('Full Name'),
  designation: reqText('Designation', 100, 2),
  departmentId: reqId('Department'),
  officialMobile: z.preprocess((v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v), optText(16))
    .refine((v) => v == null || /^\+?\d{6,15}$/.test(v), 'Enter a valid official mobile number'),
  officialEmail: email,
  location: optText(100),
  isActive: bool,
});

const EMPLOYEE_SELECT = `
  e.id, e.employee_code, e.salutation, e.full_name, e.designation, e.department_id, d.name AS department_name,
  e.official_mobile, e.official_email::text AS official_email, e.location, e.is_active, e.created_at, e.updated_at,
  (SELECT count(*) FROM visits vv WHERE vv.host_employee_id = e.id) AS visit_count`;

const shapeEmployee = (r) => ({
  id: r.id, employeeCode: r.employee_code, salutation: r.salutation, fullName: r.full_name,
  displayName: `${r.salutation ? `${r.salutation} ` : ''}${r.full_name}`,
  designation: r.designation, departmentId: r.department_id, departmentName: r.department_name,
  officialMobile: r.official_mobile, officialEmail: r.official_email, location: r.location, isActive: r.is_active,
  visitCount: r.visit_count, createdAt: r.created_at, updatedAt: r.updated_at,
});

employeesRouter.get('/', requirePermission('employee.view', 'employee.manage', 'prereg.any'), async (req, res) => {
  const f = parse(pageParams.extend({
    q: z.string().trim().max(100).optional(),
    departmentId: z.coerce.number().int().positive().optional(),
    active: z.enum(['true', 'false', 'all']).default('true'),
  }), req.query);
  const params = [];
  const where = ['e.deleted_at IS NULL'];
  if (f.active !== 'all') { params.push(f.active === 'true'); where.push(`e.is_active = $${params.length}`); }
  if (f.departmentId) { params.push(f.departmentId); where.push(`e.department_id = $${params.length}`); }
  let rank = 'e.full_name';
  if (f.q) {
    params.push(f.q);
    const p = `$${params.length}`;
    where.push(`(e.full_name ILIKE '%' || ${p} || '%' OR ${p} <% e.full_name OR e.designation ILIKE '%' || ${p} || '%'
                 OR d.name ILIKE '%' || ${p} || '%' OR e.employee_code ILIKE ${p} || '%')`);
    rank = `CASE WHEN e.full_name ILIKE ${p} || '%' THEN 0 WHEN e.full_name ILIKE '% ' || ${p} || '%' THEN 1 WHEN ${p} <% e.full_name THEN 2 ELSE 3 END, word_similarity(${p}, e.full_name) DESC, e.full_name`;
  }
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await query(
    `SELECT ${EMPLOYEE_SELECT}, count(*) OVER () AS total_count
       FROM employees e JOIN departments d ON d.id = e.department_id
      WHERE ${where.join(' AND ')} ORDER BY ${rank} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ items: rows.map(shapeEmployee), total: rows[0]?.total_count ?? 0, page: f.page, pageSize: f.pageSize });
});

employeesRouter.get('/:id', requirePermission('employee.view', 'employee.manage'), async (req, res) => {
  const { rows } = await query(`SELECT ${EMPLOYEE_SELECT} FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.id = $1 AND e.deleted_at IS NULL`, [Number(req.params.id) || 0]);
  if (!rows[0]) throw notFound('Employee record not found.');
  res.json({ employee: shapeEmployee(rows[0]) });
});

async function assertDepartment(client, id) {
  const { rows } = await client.query('SELECT 1 FROM departments WHERE id = $1 AND is_active AND deleted_at IS NULL', [id]);
  if (!rows[0]) throw validationError({ departmentId: 'Select a valid, active department' });
}

employeesRouter.post('/', requirePermission('employee.manage'), async (req, res) => {
  const b = parse(employeeSchema, req.body);
  const ctx = auditContext(req);
  const id = await withTransaction(async (client) => {
    await assertDepartment(client, b.departmentId);
    const { rows } = await client.query(
      `INSERT INTO employees (employee_code, salutation, full_name, designation, department_id, official_mobile, official_email, location, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
      [b.employeeCode.toUpperCase(), b.salutation ?? null, b.fullName, b.designation, b.departmentId, b.officialMobile ?? null, b.officialEmail ?? null, b.location ?? null, b.isActive ?? true, ctx.userId],
    );
    await audit(ctx, { action: 'HOST_ADDED', entityType: 'employee', entityId: rows[0].id, entityRef: b.employeeCode.toUpperCase(), summary: `Host added: ${b.fullName}, ${b.designation}`, newValues: b }, client);
    return rows[0].id;
  });
  const { rows } = await query(`SELECT ${EMPLOYEE_SELECT} FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.id = $1`, [id]);
  res.status(201).json({ employee: shapeEmployee(rows[0]), message: 'Employee / host information has been saved successfully.' });
});

employeesRouter.put('/:id', requirePermission('employee.manage'), async (req, res) => {
  const id = Number(req.params.id) || 0;
  const b = parse(employeeSchema, req.body);
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Employee record not found.');
    await assertDepartment(client, b.departmentId);
    const next = {
      employee_code: b.employeeCode.toUpperCase(), salutation: b.salutation ?? null, full_name: b.fullName, designation: b.designation,
      department_id: b.departmentId, official_mobile: b.officialMobile ?? null, official_email: b.officialEmail ?? null,
      location: b.location ?? null, is_active: b.isActive ?? rows[0].is_active,
    };
    const { oldValues, newValues, changed } = diff(rows[0], next);
    if (!changed) return;
    await client.query(
      `UPDATE employees SET employee_code = $2, salutation = $3, full_name = $4, designation = $5, department_id = $6, official_mobile = $7,
              official_email = $8, location = $9, is_active = $10, updated_by = $11 WHERE id = $1`,
      [id, ...Object.values(next), ctx.userId],
    );
    await audit(ctx, { action: 'HOST_MODIFIED', entityType: 'employee', entityId: id, entityRef: next.employee_code, summary: `Host modified: ${b.fullName} (${Object.keys(newValues).join(', ')})`, oldValues, newValues }, client);
  });
  const { rows } = await query(`SELECT ${EMPLOYEE_SELECT} FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.id = $1`, [id]);
  res.json({ employee: shapeEmployee(rows[0]), message: 'Employee / host information has been saved successfully.' });
});

employeesRouter.delete('/:id', requirePermission('employee.manage'), async (req, res) => {
  const id = Number(req.params.id) || 0;
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT employee_code, full_name FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Employee record not found.');
    const open = await client.query(`SELECT 1 FROM visits WHERE host_employee_id = $1 AND status IN ('EXPECTED','PENDING_APPROVAL','APPROVED','CHECKED_IN','OVERSTAY') LIMIT 1`, [id]);
    if (open.rows[0]) throw validationError({}, 'This host has open or upcoming visits. Reassign or close them before removing the host.');
    // Soft delete: historical visits keep their reference to the host.
    await client.query('UPDATE employees SET deleted_at = now(), is_active = FALSE, updated_by = $2 WHERE id = $1', [id, ctx.userId]);
    await audit(ctx, { action: 'HOST_REMOVED', entityType: 'employee', entityId: id, entityRef: rows[0].employee_code, summary: `Host removed (archived): ${rows[0].full_name}` }, client);
  });
  res.json({ message: 'The employee / host has been removed from the active directory.' });
});

// =============================================================================
// Organisation / Company Directory
// =============================================================================
export const companiesRouter = Router();

const companySchema = z.object({
  name: reqText('Company Name', 150, 2).transform((v) => v.replace(/\s+/g, ' ')),
  address: optText(300),
  contactPerson: optText(100),
  contactNumber: z.preprocess((v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v), optText(20))
    .refine((v) => v == null || /^\+?\d{6,15}$/.test(v), 'Enter a valid contact number'),
  email,
  website: optText(200).refine((v) => v == null || /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v), 'Enter a valid website address'),
  category: optText(60),
  isActive: bool,
});

const shapeCompany = (r) => ({
  id: r.id, name: r.name, address: r.address, contactPerson: r.contact_person, contactNumber: r.contact_number, email: r.email,
  website: r.website, category: r.category, isActive: r.is_active, visitorCount: r.visitor_count, visitCount: r.visit_count,
  lastVisitAt: r.last_visit_at, createdAt: r.created_at,
});

const COMPANY_SELECT = `co.id, co.name, co.address, co.contact_person, co.contact_number, co.email::text AS email, co.website, co.category,
  co.is_active, co.created_at,
  (SELECT count(*) FROM visitors vv WHERE vv.company_id = co.id) AS visitor_count,
  (SELECT count(*) FROM visits vi WHERE vi.company_id = co.id AND vi.check_in_at IS NOT NULL) AS visit_count,
  (SELECT max(vi.check_in_at) FROM visits vi WHERE vi.company_id = co.id) AS last_visit_at`;

companiesRouter.get('/', requirePermission('company.view', 'company.manage'), async (req, res) => {
  const f = parse(pageParams.extend({
    q: z.string().trim().max(150).optional(),
    active: z.enum(['true', 'false', 'all']).default('true'),
    compact: z.enum(['true', 'false']).optional(),
  }), req.query);
  const params = [];
  const where = ['co.deleted_at IS NULL'];
  if (f.active !== 'all') { params.push(f.active === 'true'); where.push(`co.is_active = $${params.length}`); }
  let rank = 'co.name';
  if (f.q) {
    params.push(f.q);
    const p = `$${params.length}`;
    where.push(`(co.name ILIKE '%' || ${p} || '%' OR ${p} <% co.name)`);
    rank = `CASE WHEN lower(co.name) = lower(${p}) THEN 0 WHEN co.name ILIKE ${p} || '%' THEN 1 WHEN co.name ILIKE '%' || ${p} || '%' THEN 2 ELSE 3 END, word_similarity(${p}, co.name) DESC, co.name`;
  }
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const select = f.compact === 'true' ? 'co.id, co.name, co.is_active, co.category' : COMPANY_SELECT;
  const { rows } = await query(
    `SELECT ${select}, count(*) OVER () AS total_count FROM companies co
      WHERE ${where.join(' AND ')} ORDER BY ${rank} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ items: rows.map(shapeCompany), total: rows[0]?.total_count ?? 0, page: f.page, pageSize: f.pageSize });
});

companiesRouter.get('/:id', requirePermission('company.view', 'company.manage'), async (req, res) => {
  const { rows } = await query(`SELECT ${COMPANY_SELECT} FROM companies co WHERE co.id = $1 AND co.deleted_at IS NULL`, [Number(req.params.id) || 0]);
  if (!rows[0]) throw notFound('Organisation record not found.');
  res.json({ company: shapeCompany(rows[0]) });
});

companiesRouter.post('/', requirePermission('company.create', 'company.manage'), async (req, res) => {
  const b = parse(companySchema, req.body);
  const ctx = auditContext(req);
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO companies (name, address, contact_person, contact_number, email, website, category, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
      [b.name, b.address ?? null, b.contactPerson ?? null, b.contactNumber ?? null, b.email ?? null, b.website ?? null, b.category ?? null, b.isActive ?? true, ctx.userId],
    );
    await audit(ctx, { action: 'COMPANY_CREATED', entityType: 'company', entityId: rows[0].id, entityRef: b.name, summary: `Organisation added: ${b.name}`, newValues: b }, client);
    return rows[0].id;
  });
  const { rows } = await query(`SELECT ${COMPANY_SELECT} FROM companies co WHERE co.id = $1`, [id]);
  res.status(201).json({ company: shapeCompany(rows[0]), message: 'Organisation information has been saved successfully.' });
});

companiesRouter.put('/:id', requirePermission('company.manage'), async (req, res) => {
  const id = Number(req.params.id) || 0;
  const b = parse(companySchema, req.body);
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM companies WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Organisation record not found.');
    const next = {
      name: b.name, address: b.address ?? null, contact_person: b.contactPerson ?? null, contact_number: b.contactNumber ?? null,
      email: b.email ?? null, website: b.website ?? null, category: b.category ?? null, is_active: b.isActive ?? rows[0].is_active,
    };
    const { oldValues, newValues, changed } = diff(rows[0], next);
    if (!changed) return;
    await client.query(
      `UPDATE companies SET name = $2, address = $3, contact_person = $4, contact_number = $5, email = $6, website = $7, category = $8,
              is_active = $9, updated_by = $10 WHERE id = $1`, [id, ...Object.values(next), ctx.userId],
    );
    await audit(ctx, { action: 'COMPANY_UPDATED', entityType: 'company', entityId: id, entityRef: b.name, summary: `Organisation updated: ${b.name}`, oldValues, newValues }, client);
  });
  const { rows } = await query(`SELECT ${COMPANY_SELECT} FROM companies co WHERE co.id = $1`, [id]);
  res.json({ company: shapeCompany(rows[0]), message: 'Organisation information has been saved successfully.' });
});

companiesRouter.delete('/:id', requirePermission('company.manage'), async (req, res) => {
  const id = Number(req.params.id) || 0;
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT name FROM companies WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Organisation record not found.');
    await client.query('UPDATE companies SET deleted_at = now(), is_active = FALSE, updated_by = $2 WHERE id = $1', [id, ctx.userId]);
    await audit(ctx, { action: 'COMPANY_ARCHIVED', entityType: 'company', entityId: id, entityRef: rows[0].name, summary: `Organisation archived: ${rows[0].name}` }, client);
  });
  res.json({ message: 'The organisation has been archived.' });
});

// =============================================================================
// Configurable masters: departments, visitor categories, purposes, access areas, ID types
// =============================================================================
export const mastersRouter = Router();

const codeField = reqText('Code', 30).transform((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
const MASTER_TYPES = {
  departments: {
    table: 'departments', entity: 'department', label: 'Department', softDelete: true,
    columns: { code: 'code', name: 'name', isActive: 'is_active' },
    schema: z.object({ code: codeField, name: reqText('Name', 100, 2), isActive: bool }),
  },
  categories: {
    table: 'visitor_categories', entity: 'visitor_category', label: 'Visitor Category',
    columns: { code: 'code', name: 'name', requiresApproval: 'requires_approval', requiresId: 'requires_id', rollCallGroup: 'roll_call_group', sortOrder: 'sort_order', isActive: 'is_active' },
    schema: z.object({
      code: codeField, name: reqText('Name', 100, 2), requiresApproval: bool, requiresId: bool,
      rollCallGroup: z.enum(['VISITOR', 'CONTRACTOR', 'SERVICE', 'EMPLOYEE']).optional(), sortOrder: z.coerce.number().int().min(0).max(9999).optional(), isActive: bool,
    }),
  },
  purposes: {
    table: 'purposes', entity: 'purpose', label: 'Purpose of Visit',
    columns: { code: 'code', name: 'name', requiresSpecify: 'requires_specify', sortOrder: 'sort_order', isActive: 'is_active' },
    schema: z.object({ code: codeField, name: reqText('Name', 100, 2), requiresSpecify: bool, sortOrder: z.coerce.number().int().min(0).max(9999).optional(), isActive: bool }),
  },
  'access-areas': {
    table: 'access_areas', entity: 'access_area', label: 'Access Area',
    columns: { code: 'code', name: 'name', isRestricted: 'is_restricted', requiresApproval: 'requires_approval', sortOrder: 'sort_order', isActive: 'is_active' },
    schema: z.object({ code: codeField, name: reqText('Name', 100, 2), isRestricted: bool, requiresApproval: bool, sortOrder: z.coerce.number().int().min(0).max(9999).optional(), isActive: bool }),
  },
  'id-types': {
    table: 'id_types', entity: 'id_type', label: 'ID Type',
    columns: { code: 'code', name: 'name', sortOrder: 'sort_order', isActive: 'is_active' },
    schema: z.object({ code: codeField, name: reqText('Name', 100, 2), sortOrder: z.coerce.number().int().min(0).max(9999).optional(), isActive: bool }),
  },
};

function shapeMaster(type, row) {
  const out = { id: row.id };
  for (const [key, col] of Object.entries(MASTER_TYPES[type].columns)) out[key] = row[col];
  return out;
}

async function listMaster(type, { activeOnly }) {
  const m = MASTER_TYPES[type];
  const where = [m.softDelete ? 'deleted_at IS NULL' : 'TRUE', activeOnly ? 'is_active' : 'TRUE'].join(' AND ');
  const order = m.columns.sortOrder ? 'sort_order, name' : 'name';
  const { rows } = await query(`SELECT * FROM ${m.table} WHERE ${where} ORDER BY ${order}`);
  return rows.map((r) => shapeMaster(type, r));
}

// GET /api/masters — every dropdown list the registration forms need, in one request.
mastersRouter.get('/', requireAuth, async (req, res) => {
  const activeOnly = req.query.all !== 'true';
  const [departments, categories, purposes, accessAreas, idTypes] = await Promise.all(
    ['departments', 'categories', 'purposes', 'access-areas', 'id-types'].map((t) => listMaster(t, { activeOnly })),
  );
  res.json({ departments, categories, purposes, accessAreas, idTypes });
});

mastersRouter.get('/:type', requireAuth, async (req, res) => {
  if (!MASTER_TYPES[req.params.type]) throw notFound();
  res.json({ items: await listMaster(req.params.type, { activeOnly: req.query.all !== 'true' }) });
});

mastersRouter.post('/:type', requirePermission('master.manage'), async (req, res) => {
  const m = MASTER_TYPES[req.params.type];
  if (!m) throw notFound();
  const b = parse(m.schema, req.body);
  const ctx = auditContext(req);
  const row = await withTransaction(async (client) => {
    const cols = Object.entries(m.columns).filter(([k]) => b[k] !== undefined);
    const { rows } = await client.query(
      `INSERT INTO ${m.table} (${cols.map(([, c]) => c).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      cols.map(([k]) => b[k]),
    );
    await audit(ctx, { action: 'MASTER_CREATED', entityType: m.entity, entityId: rows[0].id, entityRef: b.name, summary: `${m.label} added: ${b.name}`, newValues: b }, client);
    return rows[0];
  });
  res.status(201).json({ item: shapeMaster(req.params.type, row), message: `${m.label} has been saved successfully.` });
});

mastersRouter.put('/:type/:id', requirePermission('master.manage'), async (req, res) => {
  const m = MASTER_TYPES[req.params.type];
  if (!m) throw notFound();
  const id = Number(req.params.id) || 0;
  const b = parse(m.schema.partial(), req.body);
  const ctx = auditContext(req);
  const row = await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT * FROM ${m.table} WHERE id = $1 ${m.softDelete ? 'AND deleted_at IS NULL' : ''} FOR UPDATE`, [id]);
    if (!rows[0]) throw notFound(`${m.label} not found.`);
    const next = {};
    for (const [k, c] of Object.entries(m.columns)) if (b[k] !== undefined) next[c] = b[k];
    const { oldValues, newValues, changed } = diff(rows[0], next);
    if (!changed) return rows[0];
    const cols = Object.keys(newValues);
    const { rows: upd } = await client.query(
      `UPDATE ${m.table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => newValues[c])],
    );
    await audit(ctx, { action: 'MASTER_UPDATED', entityType: m.entity, entityId: id, entityRef: upd[0].name, summary: `${m.label} updated: ${upd[0].name}`, oldValues, newValues }, client);
    return upd[0];
  });
  res.json({ item: shapeMaster(req.params.type, row), message: `${m.label} has been saved successfully.` });
});

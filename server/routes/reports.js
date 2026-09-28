import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { forbidden } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { fmtDate, fmtTime } from '../lib/format.js';
import { can, requirePermission } from '../middleware/auth.js';
import { audit, auditContext } from '../services/audit.js';
import { getSetting, orgTimezone } from '../services/settings.js';
import { reportCatalogue, reportDefinition, runReport, emergencyRollCall } from '../services/reports.js';
import { toCsv, toPdf, toXlsx } from '../services/exporters.js';
import { STATUS_LABELS } from '../services/visits.js';

export const reportsRouter = Router();

const listParams = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(5).max(500).default(25),
  sort: z.string().max(30).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  period: z.enum(['today', 'yesterday', 'week', 'month', 'last30', 'year', 'custom', 'all']).optional(),
  columns: z.string().max(500).optional(),
});

function checkAccess(req, type) {
  const def = reportDefinition(type);
  if (type === 'on-premises') {
    if (!can(req, 'report.view') && !can(req, 'onpremises.view')) throw forbidden();
  } else if (!can(req, 'report.view')) {
    throw forbidden();
  }
  if (def.permission && !can(req, def.permission)) throw forbidden();
  return def;
}

async function filterLabels(f) {
  const labels = [];
  const lookup = async (ids, sql, label) => {
    if (!ids?.length) return;
    const { rows } = await query(sql, [ids]);
    labels.push([label, rows.map((r) => r.name).join(', ')]);
  };
  await lookup(f.hostId, 'SELECT full_name AS name FROM employees WHERE id = ANY($1)', 'Host');
  await lookup(f.departmentId, 'SELECT name FROM departments WHERE id = ANY($1)', 'Department');
  await lookup(f.companyId, 'SELECT name FROM companies WHERE id = ANY($1)', 'Company');
  await lookup(f.purposeId, 'SELECT name FROM purposes WHERE id = ANY($1)', 'Purpose');
  await lookup(f.categoryId, 'SELECT name FROM visitor_categories WHERE id = ANY($1)', 'Category');
  if (f.status?.length) labels.push(['Status', f.status.map((s) => STATUS_LABELS[s]).join(', ')]);
  if (f.q) labels.push(['Search', f.q]);
  if (f.company) labels.push(['Company', f.company]);
  return labels;
}

reportsRouter.get('/', requirePermission('report.view', 'onpremises.view'), async (req, res) => {
  res.json({ groups: reportCatalogue((p) => can(req, p)), canExport: can(req, 'report.export') });
});

// Emergency roll call (must be reachable instantly by security / reception).
reportsRouter.get('/emergency', requirePermission('emergency.view'), async (req, res) => {
  const sec = await getSetting('security');
  const data = await emergencyRollCall({ showContact: sec.showContactOnEmergencyList !== false });
  await audit(auditContext(req), { action: 'EMERGENCY_LIST_VIEWED', entityType: 'report', entityRef: 'emergency', summary: `Emergency roll call viewed (${data.total} on premises)` });
  res.json(data);
});

reportsRouter.get('/emergency/export', requirePermission('emergency.view'), async (req, res) => {
  const tz = await orgTimezone();
  const org = await getSetting('organisation');
  const sec = await getSetting('security');
  const data = await emergencyRollCall({ showContact: sec.showContactOnEmergencyList !== false });
  const rows = [];
  let n = 0;
  for (const g of data.groups) {
    for (const r of g.items) rows.push({ slNo: ++n, group: g.title, ...r, present: '☐' });
  }
  const columns = [
    { key: 'slNo', label: 'Sl. No.', type: 'number' }, { key: 'group', label: 'Group', type: 'text' }, { key: 'visitor', label: 'Name', type: 'text' },
    { key: 'company', label: 'Organisation / Company', type: 'text' }, { key: 'host', label: 'Host / Officer', type: 'text' },
    { key: 'accessArea', label: 'Location / Access Area', type: 'text' }, { key: 'checkIn', label: 'Check-In', type: 'time' },
    ...(sec.showContactOnEmergencyList !== false ? [{ key: 'mobile', label: 'Contact', type: 'text' }] : []),
    { key: 'passNumber', label: 'Pass No.', type: 'text' }, { key: 'accounted', label: 'Accounted For', type: 'text' },
  ];
  const meta = { title: 'Emergency Visitor Accountability – Roll Call', organisation: org, tz, filters: {}, filterLabels: [['Status', 'Currently on premises']], generatedBy: req.user.fullName, total: rows.length };
  const pdf = await toPdf(meta, columns, rows.map((r) => ({ ...r, accounted: '' })));
  await audit(auditContext(req), { action: 'EMERGENCY_LIST_EXPORTED', entityType: 'report', entityRef: 'emergency', summary: `Emergency roll call PDF generated (${rows.length} persons)` });
  res.set('Content-Disposition', `attachment; filename="emergency-roll-call-${fmtDate(tz, new Date())}-${fmtTime(tz, new Date()).replace(/[: ]/g, '')}.pdf"`);
  res.type('application/pdf').send(pdf);
});

// GET /api/reports/visitors — general visitor register (alias of date-wise)
reportsRouter.get('/visitors', async (req, res, next) => {
  req.params.type = 'date-wise';
  return runHandler(req, res, next);
});

async function runHandler(req, res) {
  const type = req.params.type;
  checkAccess(req, type);
  const p = parse(listParams, req.query);
  const tz = await orgTimezone();
  const result = await runReport(type, { ...req.query, period: p.period }, {
    page: p.page, pageSize: p.pageSize, sort: p.sort, dir: p.dir, tz, can: (perm) => can(req, perm),
  });
  res.json({
    type,
    title: result.definition.title,
    kind: result.definition.kind,
    columns: result.definition.columns,
    filters: result.filters,
    rows: result.rows,
    totals: result.totals ?? null,
    total: result.total,
    page: p.page,
    pageSize: p.pageSize,
    canExport: can(req, 'report.export'),
  });
}
reportsRouter.get('/:type', runHandler);

// GET /api/reports/:type/export?format=pdf|xlsx|csv  (+ the same filters as the on-screen report)
reportsRouter.get('/:type/export', requirePermission('report.export'), async (req, res) => {
  const type = req.params.type;
  const def = checkAccess(req, type);
  const p = parse(listParams.extend({ format: z.enum(['pdf', 'xlsx', 'csv'], { error: 'Select PDF, Excel or CSV' }) }), req.query);
  const tz = await orgTimezone();
  const org = await getSetting('organisation');
  const result = await runReport(type, { ...req.query, period: p.period }, {
    all: true, maxRows: p.format === 'pdf' ? 5000 : 50000, sort: p.sort, dir: p.dir, tz, can: (perm) => can(req, perm),
  });
  const meta = {
    title: def.title, organisation: org, tz, filters: result.filters, filterLabels: await filterLabels(result.filters),
    generatedBy: `${req.user.fullName} (${req.user.roleName})`, totals: result.totals, total: result.total,
    visibleKeys: p.columns ? p.columns.split(',').filter(Boolean) : null,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${type}-report-${stamp}`;
  let body;
  if (p.format === 'csv') {
    body = toCsv(meta, def.columns, result.rows);
    res.type('text/csv; charset=utf-8');
  } else if (p.format === 'xlsx') {
    body = await toXlsx(meta, def.columns, result.rows);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } else {
    body = await toPdf(meta, def.columns, result.rows);
    res.type('application/pdf');
  }
  await audit(auditContext(req), {
    action: 'REPORT_EXPORTED', entityType: 'report', entityRef: type,
    summary: `${def.title} exported as ${p.format.toUpperCase()} (${result.rows.length} records)`,
    newValues: { format: p.format, filters: result.filters },
  });
  res.set('Content-Disposition', `attachment; filename="${base}.${p.format}"`);
  res.send(body);
});

import { z } from 'zod';
import { parse } from '../lib/validation.js';
import { STATUSES } from './visits.js';

const idList = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',')),
  z.array(z.coerce.number().int().positive()).max(50).optional(),
);
const date = z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date').optional());
const text = (max = 100) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

export const visitFilterSchema = z.object({
  from: date,
  to: date,
  q: text(100),
  visitorName: text(100),
  mobile: text(20),
  email: text(120),
  company: text(120),
  companyId: idList,
  passNumber: text(40),
  visitCode: text(40),
  hostId: idList,
  departmentId: idList,
  purposeId: idList,
  categoryId: idList,
  accessAreaId: idList,
  status: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',')),
    z.array(z.enum(STATUSES, { error: 'Select a valid status' })).optional(),
  ),
  visitorType: z.enum(['FIRST_TIME', 'REPEAT']).optional().or(z.literal('').transform(() => undefined)),
  withVehicle: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional()),
  watchlist: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional()),
  visitorId: z.coerce.number().int().positive().optional(),
});

export function parseVisitFilters(queryParams) {
  const f = parse(visitFilterSchema, queryParams);
  if (f.from && f.to && f.from > f.to) [f.from, f.to] = [f.to, f.from];
  return f;
}

/**
 * Build a parameterised WHERE clause over the standard visit joins
 * (aliases: vi visits, v visitors, c companies, e employees, pass visitor_passes).
 * Every value is bound as a parameter – never interpolated.
 */
export function buildVisitWhere(f, { hostScopeEmployeeId = null, startIndex = 1 } = {}) {
  const clauses = [];
  const params = [];
  const add = (value) => { params.push(value); return `$${startIndex + params.length - 1}`; };

  if (hostScopeEmployeeId != null) clauses.push(`vi.host_employee_id = ${add(hostScopeEmployeeId)}`);
  if (f.from) clauses.push(`vi.appointment_date >= ${add(f.from)}::date`);
  if (f.to) clauses.push(`vi.appointment_date <= ${add(f.to)}::date`);
  if (f.visitorId) clauses.push(`vi.visitor_id = ${add(f.visitorId)}`);
  if (f.q) {
    const q = f.q;
    const digits = q.replace(/[\s\-+()]/g, '');
    if (/^(VST|PASS|VIS)-/i.test(q)) {
      const p = add(q.toUpperCase());
      clauses.push(`(vi.visit_code = ${p} OR pass.pass_number = ${p} OR v.visitor_code = ${p})`);
    } else if (/^\d{3,15}$/.test(digits)) {
      clauses.push(`v.mobile_number LIKE '%' || ${add(digits)} || '%'`);
    } else {
      const p = add(q);
      clauses.push(`(v.full_name ILIKE '%' || ${p} || '%' OR c.name ILIKE '%' || ${p} || '%' OR v.email::text ILIKE '%' || ${p} || '%'
                     OR vi.host_name_snapshot ILIKE '%' || ${p} || '%')`);
    }
  }
  if (f.visitorName) clauses.push(`v.full_name ILIKE '%' || ${add(f.visitorName)} || '%'`);
  if (f.mobile) clauses.push(`v.mobile_number LIKE '%' || ${add(f.mobile.replace(/\D/g, ''))} || '%'`);
  if (f.email) clauses.push(`v.email::text ILIKE '%' || ${add(f.email)} || '%'`);
  if (f.company) clauses.push(`c.name ILIKE '%' || ${add(f.company)} || '%'`);
  if (f.companyId?.length) clauses.push(`vi.company_id = ANY(${add(f.companyId)}::int[])`);
  if (f.passNumber) clauses.push(`pass.pass_number = upper(${add(f.passNumber)})`);
  if (f.visitCode) clauses.push(`vi.visit_code = upper(${add(f.visitCode)})`);
  if (f.hostId?.length) clauses.push(`vi.host_employee_id = ANY(${add(f.hostId)}::int[])`);
  if (f.departmentId?.length) clauses.push(`vi.department_id = ANY(${add(f.departmentId)}::int[])`);
  if (f.purposeId?.length) clauses.push(`vi.purpose_id = ANY(${add(f.purposeId)}::int[])`);
  if (f.categoryId?.length) clauses.push(`vi.category_id = ANY(${add(f.categoryId)}::int[])`);
  if (f.accessAreaId?.length) clauses.push(`vi.access_area_id = ANY(${add(f.accessAreaId)}::int[])`);
  if (f.status?.length) clauses.push(`vi.status = ANY(${add(f.status)}::text[])`);
  if (f.withVehicle === true) clauses.push('vi.vehicle_id IS NOT NULL');
  if (f.watchlist === true) clauses.push(`v.watchlist_status <> 'NONE'`);
  if (f.visitorType === 'FIRST_TIME') {
    clauses.push(`vi.check_in_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM visits pv WHERE pv.visitor_id = vi.visitor_id AND pv.check_in_at < vi.check_in_at)`);
  } else if (f.visitorType === 'REPEAT') {
    clauses.push(`vi.check_in_at IS NOT NULL AND EXISTS (SELECT 1 FROM visits pv WHERE pv.visitor_id = vi.visitor_id AND pv.check_in_at < vi.check_in_at)`);
  }
  return { where: clauses.length ? clauses.join(' AND ') : 'TRUE', params };
}

// Whitelisted sort keys -> SQL expressions (never interpolate user input).
export const VISIT_SORTS = {
  date: 'vi.appointment_date',
  visitor: 'v.full_name',
  company: 'c.name',
  host: 'vi.host_name_snapshot',
  department: 'd.name',
  purpose: 'p.name',
  checkIn: 'vi.check_in_at',
  checkOut: 'vi.check_out_at',
  duration: 'coalesce(vi.duration_minutes, 0)',
  status: 'vi.status',
  visitCode: 'vi.visit_code',
  passNumber: 'pass.pass_number',
  category: 'cat.name',
  accessArea: 'aa.name',
  vehicle: 'veh.registration_number',
};

export function orderBy(sort, dir, fallback = 'vi.appointment_date DESC, vi.check_in_at DESC NULLS LAST, vi.id DESC') {
  const expr = VISIT_SORTS[sort];
  if (!expr) return fallback;
  return `${expr} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, vi.id DESC`;
}

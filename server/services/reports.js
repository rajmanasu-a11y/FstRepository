import { query } from '../db/pool.js';
import { forbidden, notFound } from '../lib/errors.js';
import { periodRange } from '../lib/time.js';
import { buildVisitWhere, orderBy, parseVisitFilters } from './visitQuery.js';
import { VISIT_JOINS, STATUS_LABELS } from './visits.js';
import { maskMobile } from './visitors.js';

/**
 * Report registry. Every report is described once – title, columns and query –
 * and the same definition drives the on-screen table, the print view and the
 * PDF / Excel / CSV exports, so exports always honour the active filters.
 *
 * Column types: text | date | time | datetime | duration | status | number
 */

const C = (key, label, type = 'text', extra = {}) => ({ key, label, type, visible: true, sortable: true, ...extra });

const LIST_COLUMNS = [
  C('slNo', 'Sl. No.', 'number', { sortable: false }),
  C('date', 'Date', 'date'),
  C('visitCode', 'Visit No.', 'text', { visible: false }),
  C('passNumber', 'Visitor Pass Number', 'text', { visible: false }),
  C('visitor', 'Visitor'),
  C('mobile', 'Mobile', 'text', { visible: false, sortable: false }),
  C('company', 'Organisation / Company'),
  C('host', 'Host / Officer'),
  C('hostDesignation', 'Designation', 'text', { sortable: false }),
  C('department', 'Department', 'text', { visible: false }),
  C('purpose', 'Purpose of Visit'),
  C('category', 'Category', 'text', { visible: false }),
  C('accessArea', 'Access Area', 'text', { visible: false }),
  C('checkIn', 'Check-In', 'time'),
  C('checkOut', 'Check-Out', 'time'),
  C('duration', 'Duration', 'duration'),
  C('status', 'Status', 'status'),
];

const pick = (keys, overrides = {}) => keys.map((k) => {
  const col = LIST_COLUMNS.find((c) => c.key === k);
  return { ...col, visible: true, ...(overrides[k] || {}) };
});

const LIST_SELECT = `
  vi.id, vi.visit_code AS "visitCode", pass.pass_number AS "passNumber", vi.appointment_date AS date,
  v.full_name AS visitor, v.mobile_number AS mobile_raw, v.mobile_country_code AS cc, c.name AS company,
  vi.host_name_snapshot AS host, vi.host_designation_snapshot AS "hostDesignation", d.name AS department,
  CASE WHEN vi.purpose_other IS NOT NULL THEN p.name || ' – ' || vi.purpose_other ELSE p.name END AS purpose,
  cat.name AS category, cat.roll_call_group AS "rollCallGroup", aa.name AS "accessArea",
  vi.check_in_at AS "checkIn", vi.check_out_at AS "checkOut",
  CASE WHEN vi.status IN ('CHECKED_IN', 'OVERSTAY') THEN floor(extract(epoch FROM now() - vi.check_in_at) / 60)::int
       ELSE vi.duration_minutes END AS duration,
  vi.status, vi.valid_until AS "validUntil", vi.expected_duration_min AS "expectedDuration",
  veh.registration_number AS "vehicleNumber", veh.vehicle_type AS "vehicleType", vi.driver_name AS "driverName",
  vi.parking_required AS "parkingRequired", v.watchlist_status AS "watchlistStatus", v.watchlist_reason AS "watchlistReason",
  vi.status_reason AS "statusReason", vi.expected_arrival AS "expectedArrival", e.official_mobile AS "hostMobile"`;

const LIST_REPORTS = {
  daily: { title: 'Daily Visitor Report', defaultPeriod: 'today' },
  weekly: { title: 'Weekly Visitor Report', defaultPeriod: 'week' },
  monthly: { title: 'Monthly Visitor Report', defaultPeriod: 'month' },
  'date-wise': { title: 'Date-wise Visitor Report', defaultPeriod: 'last30' },
  'first-time': { title: 'First-Time Visitor Report', defaultPeriod: 'month', fixed: { visitorType: 'FIRST_TIME' } },
  'on-premises': {
    title: 'Visitors Currently On Premises', ignoreDates: true, fixed: { status: ['CHECKED_IN', 'OVERSTAY'] }, sort: 'vi.check_in_at',
    columns: [
      C('slNo', 'Sl. No.', 'number', { sortable: false }), C('passNumber', 'Pass No.'), C('visitor', 'Visitor Name'), C('company', 'Organisation / Company'),
      C('host', 'Host / Officer'), C('department', 'Department'), C('purpose', 'Purpose of Visit'), C('checkIn', 'Check-In', 'datetime'),
      C('duration', 'Duration', 'duration'), C('accessArea', 'Access Area'), C('status', 'Status', 'status'),
    ],
  },
  'checked-out': { title: 'Checked-Out Visitor Report', defaultPeriod: 'today', fixed: { status: ['CHECKED_OUT'] } },
  'pending-approval': {
    title: 'Pending Approval Report', ignoreDates: true, fixed: { status: ['PENDING_APPROVAL'] },
    columns: pick(['slNo', 'date', 'visitCode', 'visitor', 'company', 'host', 'hostDesignation', 'department', 'purpose', 'category', 'accessArea', 'status']),
  },
  overstay: {
    title: 'Overstay Report', defaultPeriod: 'month', extraWhere: `(vi.status = 'OVERSTAY' OR vi.overstay_flagged_at IS NOT NULL)`,
    columns: [
      ...pick(['slNo', 'date', 'passNumber', 'visitor', 'company', 'host', 'department', 'purpose', 'checkIn']),
      C('validUntil', 'Valid Until', 'time'), C('checkOut', 'Check-Out', 'time'), C('expectedDuration', 'Allowed', 'duration'),
      C('duration', 'Actual Duration', 'duration'), C('status', 'Status', 'status'),
    ],
  },
  vehicle: {
    title: 'Vehicle Entry Report', defaultPeriod: 'month', fixed: { withVehicle: true },
    columns: [
      ...pick(['slNo', 'date', 'visitor', 'company']), C('vehicleNumber', 'Registration No.'), C('vehicleType', 'Vehicle Type'),
      C('driverName', 'Driver Name', 'text', { sortable: false }), C('parkingRequired', 'Parking', 'text', { sortable: false }),
      ...pick(['host', 'checkIn', 'checkOut', 'status']),
    ],
  },
  restricted: {
    title: 'Restricted Visitor Report', defaultPeriod: 'year', extraWhere: `(v.watchlist_status <> 'NONE' OR vi.status = 'DENIED')`,
    columns: [
      ...pick(['slNo', 'date', 'visitCode', 'visitor', 'company']), C('watchlistStatus', 'Restriction', 'text'),
      C('watchlistReason', 'Reason on Record', 'text', { sortable: false }), ...pick(['host', 'purpose']),
      C('statusReason', 'Outcome', 'text', { sortable: false }), C('status', 'Status', 'status'),
    ],
  },
  'visitor-history': { title: 'Visitor History', defaultPeriod: 'all', requires: 'visitorId' },
};

const SUMMARY_REPORTS = {
  'host-wise': {
    title: 'Host-wise Visitor Report', defaultPeriod: 'month',
    groupSelect: `vi.host_employee_id AS gid, max(vi.host_name_snapshot) AS host, max(e.designation) AS "hostDesignation", max(d.name) AS department`,
    groupBy: 'vi.host_employee_id',
    lead: [C('host', 'Host / Officer'), C('hostDesignation', 'Designation'), C('department', 'Department')],
  },
  'department-wise': {
    title: 'Department-wise Visitor Report', defaultPeriod: 'month',
    groupSelect: `vi.department_id AS gid, max(d.name) AS department, count(DISTINCT vi.host_employee_id) AS hosts`,
    groupBy: 'vi.department_id',
    lead: [C('department', 'Department'), C('hosts', 'Hosts Visited', 'number')],
  },
  'company-wise': {
    title: 'Company-wise Visitor Report', defaultPeriod: 'month',
    groupSelect: `coalesce(vi.company_id, 0) AS gid, coalesce(max(c.name), 'Individual / Not specified') AS company`,
    groupBy: 'coalesce(vi.company_id, 0)',
    lead: [C('company', 'Organisation / Company')],
  },
  'purpose-wise': {
    title: 'Purpose-wise Visitor Report', defaultPeriod: 'month',
    groupSelect: `vi.purpose_id AS gid, max(p.name) AS purpose`,
    groupBy: 'vi.purpose_id',
    lead: [C('purpose', 'Purpose of Visit')],
  },
  'category-wise': {
    title: 'Visitor Category Report', defaultPeriod: 'month',
    groupSelect: `vi.category_id AS gid, max(cat.name) AS category`,
    groupBy: 'vi.category_id',
    lead: [C('category', 'Visitor Category')],
  },
};

const SUMMARY_METRICS = [
  C('visits', 'Total Visits', 'number'),
  C('uniqueVisitors', 'Unique Visitors', 'number'),
  C('checkedOut', 'Checked-Out', 'number'),
  C('onPremises', 'On Premises', 'number'),
  C('pending', 'Expected / Pending', 'number'),
  C('overstays', 'Overstays', 'number'),
  C('avgDuration', 'Avg. Duration', 'duration'),
];

const SUMMARY_METRIC_SQL = `
  count(*) FILTER (WHERE vi.check_in_at IS NOT NULL) AS visits,
  count(DISTINCT vi.visitor_id) FILTER (WHERE vi.check_in_at IS NOT NULL) AS "uniqueVisitors",
  count(*) FILTER (WHERE vi.status = 'CHECKED_OUT') AS "checkedOut",
  count(*) FILTER (WHERE vi.status IN ('CHECKED_IN', 'OVERSTAY')) AS "onPremises",
  count(*) FILTER (WHERE vi.status IN ('EXPECTED', 'APPROVED', 'PENDING_APPROVAL')) AS pending,
  count(*) FILTER (WHERE vi.overstay_flagged_at IS NOT NULL) AS overstays,
  round(avg(vi.duration_minutes))::int AS "avgDuration"`;

const SPECIAL_REPORTS = {
  'repeat-visitors': {
    title: 'Repeat Visitor Report', defaultPeriod: 'month',
    columns: [
      C('slNo', 'Sl. No.', 'number', { sortable: false }), C('visitorCode', 'Visitor ID'), C('visitor', 'Visitor'), C('company', 'Organisation / Company'),
      C('mobile', 'Mobile', 'text', { sortable: false }), C('visitsInPeriod', 'Visits in Period', 'number'), C('totalVisits', 'Total Visits', 'number'),
      C('firstVisit', 'First Visit', 'date'), C('lastVisit', 'Last Visit', 'date'), C('lastHost', 'Last Host', 'text', { sortable: false }),
    ],
  },
  audit: {
    title: 'Audit Report', defaultPeriod: 'today', permission: 'audit.view',
    columns: [
      C('slNo', 'Sl. No.', 'number', { sortable: false }), C('occurredAt', 'Date & Time', 'datetime'), C('username', 'User'), C('role', 'Role'),
      C('action', 'Action'), C('entityRef', 'Record', 'text'), C('summary', 'Details', 'text', { sortable: false }), C('ip', 'IP Address', 'text', { sortable: false }),
    ],
  },
};

export const REPORT_GROUPS = [
  { title: 'Visitor Registers', items: ['daily', 'weekly', 'monthly', 'date-wise'] },
  { title: 'Analysis', items: ['host-wise', 'department-wise', 'company-wise', 'purpose-wise', 'category-wise', 'repeat-visitors', 'first-time'] },
  { title: 'Operational & Security', items: ['on-premises', 'checked-out', 'pending-approval', 'overstay', 'vehicle', 'restricted'] },
  { title: 'Compliance', items: ['audit'] },
];

export function reportDefinition(type) {
  if (LIST_REPORTS[type]) {
    const r = LIST_REPORTS[type];
    return { type, kind: 'list', title: r.title, defaultPeriod: r.defaultPeriod || 'today', ignoreDates: Boolean(r.ignoreDates), columns: r.columns || LIST_COLUMNS, fixed: r.fixed || {} };
  }
  if (SUMMARY_REPORTS[type]) {
    const r = SUMMARY_REPORTS[type];
    return { type, kind: 'summary', title: r.title, defaultPeriod: r.defaultPeriod, columns: [C('slNo', 'Sl. No.', 'number', { sortable: false }), ...r.lead, ...SUMMARY_METRICS], fixed: {} };
  }
  if (SPECIAL_REPORTS[type]) {
    const r = SPECIAL_REPORTS[type];
    return { type, kind: type, title: r.title, defaultPeriod: r.defaultPeriod, columns: r.columns, permission: r.permission, fixed: {} };
  }
  throw notFound('Report not found.');
}

export function reportCatalogue(can) {
  return REPORT_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.map((t) => reportDefinition(t)).filter((d) => !d.permission || can(d.permission))
      .map((d) => ({ type: d.type, title: d.title, kind: d.kind, defaultPeriod: d.defaultPeriod, ignoreDates: Boolean(d.ignoreDates), columns: d.columns })),
  })).filter((g) => g.items.length);
}

/**
 * Execute a report.
 *   opts.all       – ignore pagination (exports / print), capped at maxRows
 *   opts.hostScope – restrict to one host employee (Host role)
 */
export async function runReport(type, rawFilters, { page = 1, pageSize = 25, sort, dir, all = false, maxRows = 50000, tz, hostScope = null, can = () => true, maskContact = true } = {}) {
  const def = reportDefinition(type);
  if (def.permission && !can(def.permission)) throw forbidden();
  const filters = parseVisitFilters({ ...rawFilters, ...def.fixed });
  const period = rawFilters.period || def.defaultPeriod;
  if (!def.ignoreDates && period !== 'all' && !(rawFilters.from || rawFilters.to) && period !== 'custom') {
    Object.assign(filters, periodRange(period, tz));
  }
  if (def.ignoreDates) { delete filters.from; delete filters.to; }
  const limit = all ? maxRows : pageSize;
  const offset = all ? 0 : (page - 1) * pageSize;
  const base = { definition: def, filters: { ...filters, period } };

  if (def.kind === 'list') {
    if (type === 'visitor-history' && !filters.visitorId) throw notFound('Select a visitor.');
    const { where, params } = buildVisitWhere(filters, { hostScopeEmployeeId: hostScope });
    const extra = LIST_REPORTS[type].extraWhere ? ` AND ${LIST_REPORTS[type].extraWhere}` : '';
    const order = sort && def.columns.some((c) => c.key === sort && c.sortable)
      ? orderBy(sort, dir, 'vi.appointment_date DESC, vi.check_in_at DESC NULLS LAST')
      : (LIST_REPORTS[type].sort || 'vi.appointment_date DESC, vi.check_in_at DESC NULLS LAST, vi.id DESC');
    const n = params.length;
    const { rows } = await query(
      `SELECT ${LIST_SELECT}, count(*) OVER () AS total_count ${VISIT_JOINS}
        WHERE ${where}${extra} ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, limit, offset],
    );
    return {
      ...base,
      total: rows[0]?.total_count ?? 0,
      rows: rows.map((r, i) => ({
        ...r,
        slNo: offset + i + 1,
        mobile: r.mobile_raw ? `${r.cc} ${maskContact ? maskMobile(r.mobile_raw) : r.mobile_raw}` : '',
        statusLabel: STATUS_LABELS[r.status],
        parkingRequired: r.vehicleNumber ? (r.parkingRequired ? 'Yes' : 'No') : '',
        vehicleType: r.vehicleType ? r.vehicleType.replace('_', ' ') : '',
        watchlistStatus: r.watchlistStatus === 'NONE' ? '—' : r.watchlistStatus,
        mobile_raw: undefined, cc: undefined, total_count: undefined,
      })),
    };
  }

  if (def.kind === 'summary') {
    const s = SUMMARY_REPORTS[type];
    const { where, params } = buildVisitWhere(filters, { hostScopeEmployeeId: hostScope });
    const sortable = new Set(def.columns.filter((c) => c.sortable).map((c) => c.key));
    const order = sort && sortable.has(sort) ? `"${sort}" ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST` : 'visits DESC, 2';
    const n = params.length;
    const { rows } = await query(
      `SELECT ${s.groupSelect}, ${SUMMARY_METRIC_SQL}, count(*) OVER () AS total_count
         ${VISIT_JOINS}
        WHERE ${where} AND vi.status NOT IN ('CANCELLED')
        GROUP BY ${s.groupBy}
        ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, limit, offset],
    );
    const { rows: totals } = await query(
      `SELECT ${SUMMARY_METRIC_SQL} ${VISIT_JOINS} WHERE ${where} AND vi.status NOT IN ('CANCELLED')`, params,
    );
    return {
      ...base,
      total: rows[0]?.total_count ?? 0,
      rows: rows.map((r, i) => ({ ...r, slNo: offset + i + 1, total_count: undefined })),
      totals: totals[0],
    };
  }

  if (type === 'repeat-visitors') {
    const { where, params } = buildVisitWhere(filters, { hostScopeEmployeeId: hostScope });
    const n = params.length;
    const sortMap = { visitor: 'visitor', company: 'company', visitsInPeriod: '"visitsInPeriod"', totalVisits: '"totalVisits"', firstVisit: '"firstVisit"', lastVisit: '"lastVisit"', visitorCode: '"visitorCode"' };
    const order = sort && sortMap[sort] ? `${sortMap[sort]} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST` : '"visitsInPeriod" DESC, "totalVisits" DESC';
    const { rows } = await query(
      `WITH inperiod AS (
         SELECT vi.visitor_id, count(*) AS n FROM visits vi JOIN visitors v ON v.id = vi.visitor_id LEFT JOIN companies c ON c.id = vi.company_id
           JOIN employees e ON e.id = vi.host_employee_id LEFT JOIN visitor_passes pass ON pass.visit_id = vi.id AND pass.status <> 'VOID'
          WHERE ${where} AND vi.check_in_at IS NOT NULL GROUP BY vi.visitor_id)
       SELECT v.id, v.visitor_code AS "visitorCode", v.full_name AS visitor, c.name AS company, v.mobile_country_code AS cc, v.mobile_number AS mobile_raw,
              ip.n AS "visitsInPeriod", v.total_visits AS "totalVisits", (v.first_visit_at) AS "firstVisit", (v.last_visit_at) AS "lastVisit",
              (SELECT lv.host_name_snapshot FROM visits lv WHERE lv.visitor_id = v.id AND lv.check_in_at IS NOT NULL ORDER BY lv.check_in_at DESC LIMIT 1) AS "lastHost",
              count(*) OVER () AS total_count
         FROM inperiod ip JOIN visitors v ON v.id = ip.visitor_id LEFT JOIN companies c ON c.id = v.company_id
        WHERE v.total_visits > 1
        ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, limit, offset],
    );
    return {
      ...base,
      total: rows[0]?.total_count ?? 0,
      rows: rows.map((r, i) => ({
        ...r, slNo: offset + i + 1, mobile: r.mobile_raw ? `${r.cc} ${maskContact ? maskMobile(r.mobile_raw) : r.mobile_raw}` : '',
        mobile_raw: undefined, cc: undefined, total_count: undefined,
      })),
    };
  }

  if (type === 'audit') {
    const params = [];
    const where = [];
    if (filters.from) { params.push(filters.from, tz); where.push(`a.occurred_at >= ($${params.length - 1}::date::timestamp AT TIME ZONE $${params.length})`); }
    if (filters.to) { params.push(filters.to, tz); where.push(`a.occurred_at < (($${params.length - 1}::date + 1)::timestamp AT TIME ZONE $${params.length})`); }
    if (rawFilters.action) { params.push(String(rawFilters.action).slice(0, 60)); where.push(`a.action = $${params.length}`); }
    if (rawFilters.user) { params.push(String(rawFilters.user).slice(0, 60)); where.push(`a.username ILIKE '%' || $${params.length} || '%'`); }
    if (filters.q) { params.push(filters.q); where.push(`(a.summary ILIKE '%' || $${params.length} || '%' OR a.entity_ref ILIKE '%' || $${params.length} || '%')`); }
    const sortMap = { occurredAt: 'a.occurred_at', username: 'a.username', role: 'a.role_code', action: 'a.action', entityRef: 'a.entity_ref' };
    const order = sort && sortMap[sort] ? `${sortMap[sort]} ${dir === 'asc' ? 'ASC' : 'DESC'}, a.id DESC` : 'a.occurred_at DESC, a.id DESC';
    const n = params.length;
    const { rows } = await query(
      `SELECT a.id, a.occurred_at AS "occurredAt", a.username, a.role_code AS role, a.action, a.entity_type AS "entityType",
              a.entity_ref AS "entityRef", a.summary, host(a.ip_address) AS ip, count(*) OVER () AS total_count
         FROM audit_logs a WHERE ${where.length ? where.join(' AND ') : 'TRUE'}
        ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...params, limit, offset],
    );
    return { ...base, total: rows[0]?.total_count ?? 0, rows: rows.map((r, i) => ({ ...r, slNo: offset + i + 1, total_count: undefined })) };
  }
  throw notFound('Report not found.');
}

/** Emergency roll call: everyone on premises, grouped for accountability. */
export async function emergencyRollCall({ showContact }) {
  const { rows } = await query(
    `SELECT ${LIST_SELECT}, v.id AS visitor_id ${VISIT_JOINS}
      WHERE vi.status IN ('CHECKED_IN', 'OVERSTAY') ORDER BY cat.roll_call_group, v.full_name`,
  );
  const groups = [
    { key: 'EMPLOYEE', title: 'Employees (Visiting Staff)', items: [] },
    { key: 'VISITOR', title: 'Visitors', items: [] },
    { key: 'CONTRACTOR', title: 'Contractors', items: [] },
    { key: 'SERVICE', title: 'Service Personnel', items: [] },
  ];
  for (const r of rows) {
    const g = groups.find((x) => x.key === r.rollCallGroup) || groups[1];
    g.items.push({
      id: r.id, passNumber: r.passNumber, visitor: r.visitor, company: r.company, host: r.host, hostMobile: showContact ? r.hostMobile : null,
      department: r.department, accessArea: r.accessArea, checkIn: r.checkIn, status: r.status, category: r.category,
      mobile: showContact && r.mobile_raw ? `${r.cc} ${r.mobile_raw}` : null,
    });
  }
  return { total: rows.length, groups, generatedAt: new Date().toISOString() };
}

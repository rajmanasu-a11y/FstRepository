import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { parse } from '../lib/validation.js';
import { periodRange, localDate, addDays, isIsoDate } from '../lib/time.js';
import { can, requirePermission } from '../middleware/auth.js';
import { orgTimezone } from '../services/settings.js';
import { VISIT_SELECT, VISIT_JOINS, shapeVisit } from '../services/visits.js';

export const dashboardRouter = Router();

const periodSchema = z.object({
  period: z.enum(['today', 'yesterday', 'week', 'month', 'custom']).default('today'),
  from: z.string().optional(),
  to: z.string().optional(),
});

function range(req, tz) {
  const p = parse(periodSchema, req.query);
  const from = isIsoDate(p.from) ? p.from : undefined;
  const to = isIsoDate(p.to) ? p.to : undefined;
  return { period: p.period, ...periodRange(p.period, tz, from, to) };
}

function scope(req) {
  if (can(req, 'visit.view_all')) return null;
  return req.user.employeeId ?? -1;
}

// GET /api/dashboard/summary — statistic cards + live visitor status table
dashboardRouter.get('/summary', requirePermission('dashboard.view'), async (req, res) => {
  const tz = await orgTimezone();
  const r = range(req, tz);
  const hostId = scope(req);
  const params = [r.from, r.to, hostId];
  const hostClause = 'AND ($3::int IS NULL OR vi.host_employee_id = $3::int)';

  const { rows: stats } = await query(
    `SELECT
       count(*) FILTER (WHERE vi.check_in_at IS NOT NULL) AS total_visitors,
       count(*) FILTER (WHERE vi.status = 'CHECKED_OUT') AS checked_out,
       count(*) FILTER (WHERE vi.status IN ('EXPECTED', 'APPROVED')) AS expected,
       count(*) FILTER (WHERE vi.status = 'DENIED') AS denied,
       count(*) FILTER (WHERE vi.check_in_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM visits pv WHERE pv.visitor_id = vi.visitor_id AND pv.check_in_at < vi.check_in_at)) AS repeat_visitors,
       count(*) FILTER (WHERE vi.check_in_at IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM visits pv WHERE pv.visitor_id = vi.visitor_id AND pv.check_in_at < vi.check_in_at)) AS first_time,
       count(*) FILTER (WHERE v.watchlist_status <> 'NONE' OR vi.status = 'DENIED') AS restricted
     FROM visits vi JOIN visitors v ON v.id = vi.visitor_id
     WHERE vi.appointment_date BETWEEN $1::date AND $2::date AND vi.status <> 'CANCELLED' ${hostClause}`,
    params,
  );
  const { rows: live } = await query(
    `SELECT count(*) FILTER (WHERE vi.status IN ('CHECKED_IN', 'OVERSTAY')) AS inside,
            count(*) FILTER (WHERE vi.status = 'OVERSTAY') AS overstay,
            count(*) FILTER (WHERE vi.status = 'PENDING_APPROVAL') AS pending
       FROM visits vi WHERE vi.status IN ('CHECKED_IN', 'OVERSTAY', 'PENDING_APPROVAL') AND ($1::int IS NULL OR vi.host_employee_id = $1::int)`,
    [hostId],
  );
  const { rows } = await query(
    `SELECT ${VISIT_SELECT} ${VISIT_JOINS}
      WHERE (vi.appointment_date BETWEEN $1::date AND $2::date OR vi.status IN ('CHECKED_IN', 'OVERSTAY'))
        AND vi.status <> 'CANCELLED' ${hostClause}
      ORDER BY CASE vi.status WHEN 'OVERSTAY' THEN 0 WHEN 'PENDING_APPROVAL' THEN 1 WHEN 'CHECKED_IN' THEN 2
                              WHEN 'APPROVED' THEN 3 WHEN 'EXPECTED' THEN 4 WHEN 'DENIED' THEN 5 ELSE 6 END,
               coalesce(vi.check_out_at, vi.check_in_at) DESC NULLS LAST, vi.expected_arrival NULLS LAST, vi.id DESC
      LIMIT 200`,
    params,
  );
  const s = stats[0];
  res.json({
    range: r,
    stats: {
      totalVisitors: s.total_visitors,
      currentlyInside: live[0].inside,
      checkedOut: s.checked_out,
      expected: s.expected,
      pendingApprovals: live[0].pending,
      repeatVisitors: s.repeat_visitors,
      firstTimeVisitors: s.first_time,
      restricted: s.restricted,
      overstay: live[0].overstay,
    },
    visits: rows.map(shapeVisit),
  });
});

// GET /api/dashboard/analytics — chart data
dashboardRouter.get('/analytics', requirePermission('dashboard.analytics'), async (req, res) => {
  const tz = await orgTimezone();
  const p = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
  const to = isIsoDate(p.to) ? p.to : localDate(tz);
  const from = isIsoDate(p.from) ? p.from : addDays(to, -29);
  const base = `FROM visits vi WHERE vi.check_in_at IS NOT NULL AND vi.appointment_date BETWEEN $1::date AND $2::date`;
  const params = [from, to];
  const [byDay, byMonth, byDept, byPurpose, byCompany, repeat, avg, hours] = await Promise.all([
    query(`SELECT d::date AS day, coalesce(x.n, 0)::int AS count
             FROM generate_series($1::date, $2::date, interval '1 day') d
             LEFT JOIN (SELECT vi.appointment_date AS day, count(*) AS n ${base} GROUP BY 1) x ON x.day = d::date
            ORDER BY 1`, params),
    query(`SELECT to_char(gs.m, 'YYYY-MM') AS month, coalesce(x.n, 0)::int AS count
             FROM generate_series(date_trunc('month', $1::date) - interval '11 months', date_trunc('month', $1::date), interval '1 month') AS gs(m)
             LEFT JOIN (SELECT date_trunc('month', vi.appointment_date) AS month_start, count(*) AS n FROM visits vi
                         WHERE vi.check_in_at IS NOT NULL GROUP BY 1) x ON x.month_start = gs.m
            ORDER BY gs.m`, [to]),
    query(`SELECT d.name AS label, count(*)::int AS count ${base.replace('FROM visits vi', 'FROM visits vi JOIN departments d ON d.id = vi.department_id')} GROUP BY d.name ORDER BY 2 DESC LIMIT 10`, params),
    query(`SELECT p.name AS label, count(*)::int AS count ${base.replace('FROM visits vi', 'FROM visits vi JOIN purposes p ON p.id = vi.purpose_id')} GROUP BY p.name ORDER BY 2 DESC LIMIT 10`, params),
    query(`SELECT coalesce(c.name, 'Individual') AS label, count(*)::int AS count ${base.replace('FROM visits vi', 'FROM visits vi LEFT JOIN companies c ON c.id = vi.company_id')} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, params),
    query(`SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM visits pv WHERE pv.visitor_id = vi.visitor_id AND pv.check_in_at < vi.check_in_at))::int AS repeat,
                  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM visits pv WHERE pv.visitor_id = vi.visitor_id AND pv.check_in_at < vi.check_in_at))::int AS first_time ${base}`, params),
    query(`SELECT round(avg(vi.duration_minutes))::int AS avg_minutes, count(vi.duration_minutes)::int AS completed ${base}`, params),
    query(`SELECT h AS hour, coalesce(x.n, 0)::int AS count FROM generate_series(0, 23) h
             LEFT JOIN (SELECT extract(hour FROM vi.check_in_at AT TIME ZONE $3)::int AS hour, count(*) AS n ${base} GROUP BY 1) x ON x.hour = h
            ORDER BY h`, [...params, tz]),
  ]);
  res.json({
    range: { from, to },
    byDay: byDay.rows,
    byMonth: byMonth.rows,
    byDepartment: byDept.rows,
    byPurpose: byPurpose.rows,
    byCompany: byCompany.rows,
    repeatVsFirst: repeat.rows[0],
    averageDuration: avg.rows[0],
    peakHours: hours.rows,
  });
});

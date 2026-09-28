import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { setup, teardown, loginAs, query } from './_helpers.js';

let admin;
let sa;
before(async () => { await setup(); admin = await loginAs('admin'); sa = await loginAs('superadmin'); });
after(teardown);

const TYPES = ['daily', 'weekly', 'monthly', 'date-wise', 'host-wise', 'department-wise', 'company-wise', 'purpose-wise', 'category-wise',
  'repeat-visitors', 'first-time', 'on-premises', 'checked-out', 'pending-approval', 'overstay', 'vehicle', 'restricted'];

test('every report type runs and returns column metadata', async () => {
  const cat = await admin.get('/reports');
  const listed = cat.data.groups.flatMap((g) => g.items.map((r) => r.type));
  for (const t of TYPES) assert.ok(listed.includes(t), `catalogue lists ${t}`);
  assert.ok(!listed.includes('audit'), 'audit report hidden without audit permission');
  for (const t of TYPES) {
    const r = await admin.get(`/reports/${t}?period=year`);
    assert.equal(r.status, 200, `${t}: ${JSON.stringify(r.data).slice(0, 200)}`);
    assert.ok(Array.isArray(r.data.rows) && r.data.columns.length > 2, t);
  }
  const audit = await sa.get('/reports/audit?period=today');
  assert.equal(audit.status, 200);
  assert.ok(audit.data.total > 0);
});

test('daily report contains today\'s visits and uses the standard columns', async () => {
  const r = await admin.get('/reports/daily');
  const keys = r.data.columns.filter((c) => c.visible).map((c) => c.label);
  assert.deepEqual(keys, ['Sl. No.', 'Date', 'Visitor', 'Organisation / Company', 'Host / Officer', 'Designation', 'Purpose of Visit', 'Check-In', 'Check-Out', 'Duration', 'Status']);
  const today = r.data.filters.from;
  assert.equal(r.data.filters.to, today);
  assert.ok(r.data.rows.length > 0);
  assert.ok(r.data.rows.every((row) => row.date === today));
});

test('date range filters restrict results and summaries add up', async () => {
  const month = await admin.get('/reports/date-wise?period=month&pageSize=500');
  const today = await admin.get('/reports/date-wise?period=today&pageSize=500');
  assert.ok(month.data.total >= today.data.total);
  const { from, to } = { from: '2026-01-01', to: '2026-01-31' };
  const custom = await admin.get(`/reports/date-wise?period=custom&from=${from}&to=${to}&pageSize=500`);
  assert.ok(custom.data.rows.every((row) => row.date >= from && row.date <= to));
  const hostwise = await admin.get('/reports/host-wise?period=year&pageSize=500');
  const sum = hostwise.data.rows.reduce((a, row) => a + row.visits, 0);
  assert.equal(sum, hostwise.data.totals.visits, 'group totals add up to the grand total');
});

test('filters by department, host, company, purpose, category and status', async () => {
  const { rows } = await query(`SELECT id FROM departments WHERE code = 'FIN'`);
  const r = await admin.get(`/reports/date-wise?period=year&departmentId=${rows[0].id}&pageSize=500`);
  assert.ok(r.data.rows.length > 0);
  assert.ok(r.data.rows.every((row) => row.department === 'Finance'));
  const st = await admin.get('/reports/date-wise?period=year&status=CHECKED_OUT&pageSize=500');
  assert.ok(st.data.rows.every((row) => row.status === 'CHECKED_OUT'));
  const host = (await query(`SELECT id FROM employees WHERE full_name = 'Rajesh Kumar'`)).rows[0].id;
  const h = await admin.get(`/reports/date-wise?period=year&hostId=${host}&pageSize=500`);
  assert.ok(h.data.rows.every((row) => row.host === 'Mr. Rajesh Kumar'));
});

test('sorting uses whitelisted columns only', async () => {
  const asc = await admin.get('/reports/date-wise?period=year&sort=visitor&dir=asc&pageSize=50');
  const names = asc.data.rows.map((r) => r.visitor);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  const bogus = await admin.get('/reports/date-wise?period=year&sort=1;DROP%20TABLE%20visits');
  assert.equal(bogus.status, 200);
});

test('exports: PDF, Excel and CSV honour the active filters and are audited', async () => {
  const report = await sa.get('/reports/daily');
  const csv = await sa.request('GET', '/reports/daily/export?format=csv', { raw: true });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="daily-report-.*\.csv"/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
  const text = bytes.subarray(3).toString('utf8');
  assert.ok(text.startsWith('"Sl. No."'), 'header row');
  assert.equal(text.trim().split('\r\n').length - 1, report.data.total, 'CSV rows = filtered total (not all data)');

  const pdf = await sa.request('GET', '/reports/daily/export?format=pdf', { raw: true });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBuf.subarray(0, 5).toString(), '%PDF-');

  const xlsx = await sa.request('GET', '/reports/host-wise/export?format=xlsx&period=month', { raw: true });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('A2').value, 'Host-wise Visitor Report');
  assert.equal(ws.getRow(6).getCell(2).value, 'Host / Officer');

  const { rows } = await query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'REPORT_EXPORTED'`);
  assert.ok(rows[0].n >= 3);
});

test('export respects the selected columns and neutralises spreadsheet formulas', async () => {
  const csv = await (await sa.request('GET', '/reports/daily/export?format=csv&columns=slNo,visitor,status', { raw: true })).text();
  assert.equal(csv.split('\r\n')[0], '"Sl. No.","Visitor","Status"');
  const { toCsv } = await import('../../server/services/exporters.js');
  const out = toCsv({ tz: 'UTC' }, [{ key: 'a', label: 'A', type: 'text' }], [{ a: '=HYPERLINK("http://evil")' }]).toString();
  assert.match(out, /"'=HYPERLINK/);
});

test('export authorisation: roles without report.export are refused', async () => {
  const r = await admin.get('/reports/daily/export?format=csv');
  assert.equal(r.status, 403);
  const rec = await loginAs('reception');
  assert.equal((await rec.get('/reports/on-premises/export?format=pdf')).status, 403);
});

test('emergency roll-call PDF is available to security', async () => {
  const sec = await loginAs('security');
  const r = await sec.request('GET', '/reports/emergency/export', { raw: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
});

test('dashboard summary and analytics', async () => {
  const s = await admin.get('/dashboard/summary?period=today');
  for (const k of ['totalVisitors', 'currentlyInside', 'checkedOut', 'expected', 'pendingApprovals', 'repeatVisitors', 'firstTimeVisitors', 'restricted']) {
    assert.equal(typeof s.data.stats[k], 'number', k);
  }
  assert.equal(s.data.stats.repeatVisitors + s.data.stats.firstTimeVisitors, s.data.stats.totalVisitors);
  const a = await admin.get('/dashboard/analytics');
  assert.equal(a.data.byDay.length, 30);
  assert.equal(a.data.byMonth.length, 12);
  assert.equal(a.data.peakHours.length, 24);
  const host = await loginAs('rajesh.kumar');
  const hs = await host.get('/dashboard/summary');
  assert.ok(hs.data.visits.every((v) => v.host.name === 'Mr. Rajesh Kumar'), 'host dashboard is scoped');
});

test('server-side PDFs: Half-A4 record (two copies on one A4 page) and badge pass', async () => {
  const { rows } = await query(`SELECT id FROM visits WHERE status = 'CHECKED_IN' LIMIT 1`);
  const rec = await loginAs('reception');
  const record = await rec.request('GET', `/print/visits/${rows[0].id}/record.pdf`, { raw: true });
  const buf = Buffer.from(await record.arrayBuffer()).toString('latin1');
  assert.equal((buf.match(/\/Type \/Page\b/g) || []).length, 1, 'exactly one page');
  assert.match(buf, /\/MediaBox \[0 0 595\.28 841\.89\]/, 'A4 portrait');
  const pass = await rec.request('GET', `/print/visits/${rows[0].id}/pass.pdf`, { raw: true });
  const pbuf = Buffer.from(await pass.arrayBuffer()).toString('latin1');
  assert.match(pbuf, /\/MediaBox \[0 0 255\.1\d* 170\.0\d*\]/, '90 mm × 60 mm badge');
});

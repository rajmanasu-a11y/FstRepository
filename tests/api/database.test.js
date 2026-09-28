import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, query, pool, loginAs, ids, visitBody } from './_helpers.js';

before(setup);
after(teardown);

test('the schema separates visitor master from visit transactions', async () => {
  const cols = async (t) => (await query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [t])).rows.map((r) => r.column_name);
  const visitCols = await cols('visits');
  for (const c of ['full_name', 'mobile_number', 'email', 'designation', 'address', 'id_reference']) assert.ok(!visitCols.includes(c), `visits must not duplicate ${c}`);
  assert.ok(visitCols.includes('visitor_id'));
  const { rows } = await query(`SELECT count(*)::int AS n FROM visits WHERE visitor_id = (SELECT id FROM visitors WHERE mobile_number = '9876543210')`);
  assert.equal(rows[0].n, 12, 'one visitor master, many visit records');
  const tables = (await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
  for (const t of ['users', 'roles', 'permissions', 'role_permissions', 'visitors', 'visits', 'companies', 'employees', 'departments', 'visitor_categories', 'purposes',
    'access_areas', 'visitor_photos', 'visitor_documents', 'visitor_passes', 'notifications', 'approvals', 'vehicles', 'audit_logs', 'system_settings', 'print_templates']) {
    assert.ok(tables.includes(t), `table ${t}`);
  }
});

test('foreign keys are enforced', async () => {
  await assert.rejects(query(`INSERT INTO visits (visit_code, visitor_id, host_employee_id, department_id, host_name_snapshot, host_designation_snapshot, purpose_id, category_id, appointment_date, status)
                              VALUES ('VST-TEST-1', 999999, 1, 1, 'x', 'y', 1, 1, current_date, 'EXPECTED')`), /visits_visitor_id_fkey/);
  await assert.rejects(query('DELETE FROM employees WHERE id = (SELECT host_employee_id FROM visits LIMIT 1)'), /violates foreign key/);
  await assert.rejects(query('DELETE FROM visitors WHERE id = (SELECT visitor_id FROM visits LIMIT 1)'), /violates foreign key/, 'visit history protects the visitor master');
});

test('unique constraints and duplicate prevention', async () => {
  await assert.rejects(query(`INSERT INTO visitors (full_name, mobile_country_code, mobile_number) VALUES ('RAMESH  KUMAR ', '+91', '9876543210')`), /visitors_mobile_uq/);
  await assert.rejects(query(`INSERT INTO companies (name) VALUES ('abc technologies  pvt. ltd.')`), /companies_name_uq/);
  await assert.rejects(query(`UPDATE visits SET visit_code = (SELECT visit_code FROM visits ORDER BY id LIMIT 1) WHERE id = (SELECT max(id) FROM visits)`), /visits_visit_code_key/);
});

test('one active check-in per visitor and one live pass per visit, enforced by the database', async () => {
  const { rows } = await query(`SELECT visitor_id FROM visits WHERE status = 'CHECKED_IN' LIMIT 1`);
  await assert.rejects(query(`UPDATE visits SET status = 'CHECKED_IN', check_in_at = now(), check_out_at = NULL WHERE visitor_id = $1 AND status = 'CHECKED_OUT'`, [rows[0].visitor_id]), /visits_one_active_per_visitor/);
  const { rows: v } = await query(`SELECT visit_id FROM visitor_passes WHERE status = 'ISSUED' LIMIT 1`);
  await assert.rejects(query(`INSERT INTO visitor_passes (pass_number, visit_id) VALUES ('PASS-X', $1)`, [v[0].visit_id]), /visitor_passes_one_live_per_visit/);
});

test('check constraints: status values, check-out after check-in, durations', async () => {
  await assert.rejects(query(`UPDATE visits SET status = 'DONE' WHERE id = 1`), /visits_status_check/);
  await assert.rejects(query(`UPDATE visits SET check_out_at = check_in_at - interval '1 minute' WHERE status = 'CHECKED_OUT' AND id = (SELECT min(id) FROM visits WHERE status = 'CHECKED_OUT')`), /visits_checkout_after_checkin/);
  await assert.rejects(query(`UPDATE visits SET expected_duration_min = 0 WHERE id = 1`), /check/);
  await assert.rejects(query(`UPDATE visitors SET mobile_number = 'abc' WHERE id = 1`), /visitors_mobile_number_check/);
});

test('NOT NULL constraints protect essential fields', async () => {
  await assert.rejects(query(`UPDATE visits SET host_employee_id = NULL WHERE id = 1`), /null value/);
  await assert.rejects(query(`UPDATE visitors SET full_name = NULL WHERE id = 1`), /null value/);
});

test('the audit log is append-only', async () => {
  await assert.rejects(query(`UPDATE audit_logs SET summary = 'tampered' WHERE id = (SELECT min(id) FROM audit_logs)`), /append-only/);
  await assert.rejects(query(`DELETE FROM audit_logs`), /append-only/);
});

test('transactions roll back completely on failure (no partial visitor without visit)', async () => {
  const i = await ids();
  const rec = await loginAs('reception');
  const before = (await query('SELECT count(*)::int AS n FROM visitors')).rows[0].n;
  const r = await rec.post('/visits', visitBody(i, { visit: { hostEmployeeId: 999999 } }));
  assert.equal(r.status, 422);
  const after = (await query('SELECT count(*)::int AS n FROM visitors')).rows[0].n;
  assert.equal(after, before, 'visitor insert rolled back with the failed visit');
});

test('document numbers are unique under heavy concurrency', async () => {
  const results = await Promise.all(Array.from({ length: 60 }, () => query(`SELECT next_document_number('TST', 2026) AS c`)));
  const codes = results.map((r) => r.rows[0].c);
  assert.equal(new Set(codes).size, 60);
  assert.ok(codes.every((c) => /^TST-2026-\d{6}$/.test(c)));
});

test('human-readable identifiers are used publicly', async () => {
  const { rows } = await query(`SELECT v.visitor_code, vi.visit_code, p.pass_number FROM visits vi JOIN visitors v ON v.id = vi.visitor_id JOIN visitor_passes p ON p.visit_id = vi.id LIMIT 1`);
  assert.match(rows[0].visitor_code, /^VIS-\d{6}$/);
  assert.match(rows[0].visit_code, /^VST-\d{4}-\d{6}$/);
  assert.match(rows[0].pass_number, /^PASS-\d{4}-\d{6}$/);
});

test('search indexes exist and are used by the planner', async () => {
  const idx = (await query(`SELECT indexname FROM pg_indexes WHERE tablename IN ('visitors','companies','employees','visits')`)).rows.map((r) => r.indexname);
  for (const n of ['visitors_mobile_prefix_idx', 'visitors_mobile_trgm', 'visitors_name_trgm', 'visitors_search_idx', 'companies_name_trgm', 'employees_name_trgm', 'visits_appointment_idx', 'visits_one_active_per_visitor']) {
    assert.ok(idx.includes(n), n);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const plan = (q, p) => client.query(`EXPLAIN ${q}`, p).then((r) => r.rows.map((x) => x['QUERY PLAN']).join('\n'));
    assert.match(await plan(`SELECT id FROM visitors WHERE mobile_number LIKE $1 || '%'`, ['98765']), /visitors_mobile/);
    assert.match(await plan(`SELECT id FROM visitors WHERE search_vector @@ to_tsquery('simple', 'ramesh:*')`, []), /visitors_search_idx/);
    assert.match(await plan(`SELECT id FROM visitors WHERE full_name ILIKE '%' || $1 || '%'`, ['mesh']), /visitors_name_trgm/);
    assert.match(await plan(`SELECT id FROM companies WHERE name ILIKE '%' || $1 || '%'`, ['tech']), /companies_name_trgm/);
    await client.query('ROLLBACK');
  } finally { client.release(); }
});

test('timestamps are stored as timestamptz (UTC) and dates follow the organisation time zone', async () => {
  const types = (await query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'visits' AND column_name IN ('check_in_at','check_out_at','created_at','appointment_date')`)).rows;
  const map = Object.fromEntries(types.map((t) => [t.column_name, t.data_type]));
  assert.equal(map.check_in_at, 'timestamp with time zone');
  assert.equal(map.created_at, 'timestamp with time zone');
  assert.equal(map.appointment_date, 'date');
  const tz = (await query('SHOW timezone')).rows[0].TimeZone;
  assert.equal(tz, 'UTC', 'database sessions run in UTC');
  const { localDate } = await import('../../server/lib/time.js');
  // 20:00 UTC is already the next day in India (UTC+05:30).
  assert.equal(localDate('Asia/Kolkata', new Date('2026-09-28T20:00:00Z')), '2026-09-29');
  const { rows } = await query(`SELECT appointment_date, (check_in_at AT TIME ZONE 'Asia/Kolkata')::date AS local_day FROM visits WHERE check_in_at IS NOT NULL AND status IN ('CHECKED_IN','OVERSTAY')`);
  assert.ok(rows.every((r) => r.appointment_date === r.local_day.toISOString?.().slice(0, 10) || String(r.appointment_date) === String(r.local_day)) || rows.length === 0);
});

test('masters are soft-deleted: removing a host keeps historical visits intact', async () => {
  const admin = await loginAs('admin');
  const { rows } = await query(`SELECT e.id FROM employees e WHERE NOT EXISTS (SELECT 1 FROM visits v WHERE v.host_employee_id = e.id AND v.status IN ('EXPECTED','PENDING_APPROVAL','APPROVED','CHECKED_IN','OVERSTAY'))
                                  AND EXISTS (SELECT 1 FROM visits v WHERE v.host_employee_id = e.id) LIMIT 1`);
  const r = await admin.del(`/employees/${rows[0].id}`);
  assert.equal(r.status, 200);
  const e = await query('SELECT deleted_at, is_active FROM employees WHERE id = $1', [rows[0].id]);
  assert.ok(e.rows[0].deleted_at);
  const v = await query('SELECT count(*)::int AS n FROM visits WHERE host_employee_id = $1', [rows[0].id]);
  assert.ok(v.rows[0].n > 0, 'visits still reference the archived host');
});

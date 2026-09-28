/**
 * Shared API test harness.
 * Each test file runs in its own process (node --test), gets a freshly migrated
 * and seeded test database, and an in-process server on an ephemeral port.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://vms:vms@localhost:5432/vms_test';
process.env.STORAGE_DIR = process.env.STORAGE_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'vms-test-storage-'));
process.env.LOGIN_RATE_LIMIT = process.env.LOGIN_RATE_LIMIT || '1000';
process.env.API_RATE_LIMIT = process.env.API_RATE_LIMIT || '100000';
process.env.NODE_ENV = 'test';

export const PASSWORD = 'Vms@Demo2026';

const { migrate } = await import('../../server/db/migrate.js');
const { seed } = await import('../../server/db/seed.js');
const { createApp } = await import('../../server/app.js');
const poolMod = await import('../../server/db/pool.js');
export const { pool, query } = poolMod;

let server;
export let baseUrl;

export async function setup() {
  await migrate({ reset: true, log: () => {} });
  await seed({ force: true, log: () => {} });
  const { invalidateSettings } = await import('../../server/services/settings.js');
  invalidateSettings();
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

export async function teardown() {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}

/** A minimal browser-like client: keeps the session cookie and CSRF token. */
export class Client {
  constructor() { this.cookie = null; this.csrf = null; }

  async request(method, url, { body, headers = {}, form, raw = false, csrf = true } = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (csrf && this.csrf && method !== 'GET') h['X-CSRF-Token'] = this.csrf;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
    const res = await fetch(`${baseUrl}/api${url}`, { method, headers: h, body: payload, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /vms_sid=([^;]*)/.exec(setCookie);
      if (m) this.cookie = m[1] ? `vms_sid=${m[1]}` : null;
    }
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }

  get(url, opts) { return this.request('GET', url, opts); }
  post(url, body, opts = {}) { return this.request('POST', url, { ...opts, body }); }
  put(url, body, opts = {}) { return this.request('PUT', url, { ...opts, body }); }
  del(url, opts) { return this.request('DELETE', url, opts); }

  async login(username, password = PASSWORD) {
    const r = await this.post('/auth/login', { username, password });
    if (r.status === 200) this.csrf = r.data.csrfToken;
    return r;
  }
}

export async function loginAs(username) {
  const c = new Client();
  const r = await c.login(username);
  if (r.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(r.data)}`);
  return c;
}

export async function ids() {
  const one = async (sql, p = []) => (await query(sql, p)).rows[0]?.id;
  return {
    rajesh: await one(`SELECT id FROM employees WHERE full_name = 'Rajesh Kumar'`),
    priya: await one(`SELECT id FROM employees WHERE full_name = 'Priya Sharma'`),
    arjun: await one(`SELECT id FROM employees WHERE full_name = 'Arjun Reddy'`),
    official: await one(`SELECT id FROM purposes WHERE code = 'OFFICIAL_MEETING'`),
    otherPurpose: await one(`SELECT id FROM purposes WHERE code = 'OTHER'`),
    guest: await one(`SELECT id FROM visitor_categories WHERE code = 'GUEST'`),
    business: await one(`SELECT id FROM visitor_categories WHERE code = 'BUSINESS'`),
    contractor: await one(`SELECT id FROM visitor_categories WHERE code = 'CONTRACTOR'`),
    conference: await one(`SELECT id FROM access_areas WHERE code = 'CONFERENCE'`),
    serverRoom: await one(`SELECT id FROM access_areas WHERE code = 'SERVER_ROOM'`),
    abc: await one(`SELECT id FROM companies WHERE name = 'ABC Technologies Pvt. Ltd.'`),
    ramesh: await one(`SELECT id FROM visitors WHERE mobile_number = '9876543210'`),
    sameer: await one(`SELECT id FROM visitors WHERE full_name = 'Sameer Khan'`),
  };
}

const usedMobiles = new Set();
/** A valid, unused Indian mobile number (random, 10 digits starting with 7). */
export function newMobile() {
  for (;;) {
    const n = `7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    if (!usedMobiles.has(n) && !/^(\d)\1+$/.test(n)) { usedMobiles.add(n); return n; }
  }
}

export function visitBody(i, overrides = {}) {
  return {
    visitor: { fullName: 'Test Visitor', mobileCountryCode: '+91', mobileNumber: newMobile(), newCompanyName: 'Test Organisation Pvt Ltd', ...overrides.visitor },
    visit: { hostEmployeeId: i.rajesh, purposeId: i.official, categoryId: i.guest, consentGiven: true, expectedDurationMin: 60, ...overrides.visit },
    ...(overrides.checkIn !== undefined ? { checkIn: overrides.checkIn } : {}),
    ...(overrides.visitorId ? { visitorId: overrides.visitorId } : {}),
  };
}

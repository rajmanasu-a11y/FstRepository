// The ElderLink API. One request handler used by the Node HTTP server and, unchanged,
// by the offline demo running inside the browser.
import { Store } from './store.js';
import { ApiError } from './util.js';
import { runJobs } from './jobs.js';
import { seed } from './seed.js';
import * as auth from './modules/auth.js';
import * as seniors from './modules/seniors.js';
import * as market from './modules/marketplace.js';
import * as bookings from './modules/bookings.js';
import * as care from './modules/care.js';
import * as emergency from './modules/emergency.js';
import * as money from './modules/money.js';
import * as ops from './modules/ops.js';
import * as extras from './modules/extras.js';
import * as homes from './modules/homes.js';

const MODULES = [auth, seniors, market, bookings, care, emergency, money, ops, extras, homes];

function compile(path) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}

export function createApi({ data, persist, demo = true } = {}) {
  const db = new Store(data);
  if (!db.data.meta.seededAt) seed(db);
  const routes = [];
  const r = (method, path, handler, opts = {}) => routes.push({ method, ...compile(path), handler, opts });
  for (const m of MODULES) m.routes(r);

  // demo-only simulation controls (time travel, reset)
  if (demo) {
    r('GET', '/demo/clock', ({ db }) => ({ now: db.now(), offset: db.data.meta.clockOffset }), { public: true });
    r('POST', '/demo/advance', ({ db, body }) => {
      db.data.meta.clockOffset += Math.max(0, Number(body.minutes) || 0) * 60000;
      const ran = runJobs(db, { force: true });
      return { now: db.now(), events: ran };
    }, { public: true });
    r('POST', '/demo/reset', ({ db }) => {
      const fresh = new Store();
      seed(fresh);
      db.data = fresh.data;
      return { ok: true };
    }, { public: true });
    r('GET', '/demo/outbox', ({ db }) => db.filter('notifications', (n) => n.channel !== 'push').slice(-150).reverse(), { public: true });
    r('POST', '/demo/jobs', ({ db }) => ({ events: runJobs(db, { force: true }) }), { public: true });
  }

  function handle(method, rawPath, { body = {}, token, query = {} } = {}) {
    const path = rawPath.replace(/^\/api/, '').split('?')[0] || '/';
    try {
      runJobs(db);
      const sess = token ? db.find('sessions', (s) => s.token === token && !s.revoked) : null;
      const user = sess ? db.get('users', sess.userId) : null;
      for (const rt of routes) {
        if (rt.method !== method) continue;
        const m = rt.re.exec(path);
        if (!m) continue;
        if (!rt.opts.public && !user) throw new ApiError(401, 'Please sign in', 'auth');
        const params = {};
        rt.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        const result = rt.handler({ db, user, body: body || {}, params, query, token, now: db.now() });
        if (method !== 'GET' || db.dirty) { db.dirty = false; persist?.(db.data); }
        return { status: 200, data: result ?? { ok: true } };
      }
      return { status: 404, data: { error: `No route ${method} ${path}` } };
    } catch (e) {
      if (e instanceof ApiError) {
        if (db.dirty) { db.dirty = false; persist?.(db.data); }
        return { status: e.status, data: { error: e.message, code: e.code } };
      }
      console.error(e);
      return { status: 500, data: { error: 'Something went wrong. Please try again.' } };
    }
  }

  return { handle, db };
}

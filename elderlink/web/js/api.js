// Transport. With the Node server running, calls go over HTTP. Without it (static hosting,
// the published demo, or offline), the same engine runs inside the browser on localStorage.
const TOKEN_KEY = 'elderlink.token';
const DB_KEY = 'elderlink.db.v1';
let mode = null;
let engine = null;
let memToken = null;

function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

export function getToken() { return memToken || load(TOKEN_KEY); }
export function setToken(t) { memToken = t; store(TOKEN_KEY, t); }
export function getMode() { return mode; }

async function startLocal() {
  const { createApi } = await import('../../core/api.js');
  let data = null;
  try { const raw = load(DB_KEY); data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  let timer = null;
  engine = createApi({
    data,
    persist: (d) => { clearTimeout(timer); timer = setTimeout(() => store(DB_KEY, JSON.stringify(d)), 150); },
  });
  store(DB_KEY, JSON.stringify(engine.db.data));
  mode = 'local';
}

export async function init() {
  if (window.ELDERLINK_MODE === 'local') return startLocal();
  try {
    const r = await fetch('/api/demo/clock', { cache: 'no-store' });
    const ct = r.headers.get('content-type') || '';
    if (r.ok && ct.includes('json')) { mode = 'remote'; return; }
  } catch { /* no server */ }
  return startLocal();
}

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

export async function call(method, path, body, query) {
  const token = getToken();
  let out;
  if (mode === 'local') {
    out = engine.handle(method, path, { body: body || {}, token, query: query || {} });
  } else {
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
    try {
      const r = await fetch('/api' + path + qs, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
      out = { status: r.status, data: await r.json() };
    } catch {
      throw new ApiError(0, 'No internet connection. Please try again.', 'offline');
    }
  }
  if (out.status >= 400) throw new ApiError(out.status, out.data?.error || 'Something went wrong', out.data?.code);
  return out.data;
}

export const api = {
  get: (p, q) => call('GET', p, null, q),
  post: (p, b) => call('POST', p, b),
  put: (p, b) => call('PUT', p, b),
  patch: (p, b) => call('PATCH', p, b),
};

export function resetLocal() { store(DB_KEY, null); }

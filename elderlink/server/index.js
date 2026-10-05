// ElderLink HTTP server: serves the web app and the JSON API, persists data to a JSON file.
// No external dependencies; Node 20+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../core/api.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const DATA_FILE = process.env.ELDERLINK_DATA || path.join(ROOT, 'data', 'elderlink.json');
const DEMO = process.env.ELDERLINK_DEMO !== 'false';

let data = null;
if (fs.existsSync(DATA_FILE) && !process.argv.includes('--reset')) {
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { data = null; }
}
let timer = null;
function persist(d) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d));
    fs.renameSync(tmp, DATA_FILE);
  }, 200);
}
const api = createApi({ data, persist, demo: DEMO });
persist(api.db.data);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, urlPath) {
  let base = path.join(ROOT, 'web');
  let rel = urlPath;
  if (urlPath.startsWith('/core/')) { base = path.join(ROOT, 'core'); rel = urlPath.slice(5); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // single-page app: unknown paths get the shell
      if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
      res.writeHead(404).end('Not found');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 2e6) req.destroy(); });
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"Bad JSON"}'); return; }
    const token = (req.headers.authorization || '').replace(/^Bearer /, '') || null;
    const query = Object.fromEntries(url.searchParams);
    const out = api.handle(req.method, url.pathname, { body, token, query });
    res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out.data));
  });
});

server.listen(PORT, () => console.log(`ElderLink running on http://localhost:${PORT} (demo controls ${DEMO ? 'on' : 'off'})`));

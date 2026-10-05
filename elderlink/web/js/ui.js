// Rendering helpers: safe HTML templates, icons, formatting, dialogs, speech and charts.
import { t, lang } from './i18n.js';

const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: true, s: String(s ?? '') });
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function val(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(val).join('');
  if (typeof v === 'object' && v[RAW]) return v.s;
  return esc(v);
}
/** Tagged template that escapes every value unless wrapped in raw() or produced by h. */
export function h(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? val(values[i]) : ''); });
  return raw(out);
}
export const str = (x) => (x && x[RAW] ? x.s : String(x ?? ''));

const P = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7zM7 10l7 7',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  sos: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  heart: 'M12 21s-7-4.4-9.3-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  check: 'M4 12l5 5L20 6',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  shield: 'M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6zM9 12l2 2 4-4',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3M16 13h2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  nurse: 'M12 3v18M3 12h18',
  hospital: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5M12 8v5M9.5 10.5h5',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  volume: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  cart: 'M3 4h2l2.4 11h11l2-8H6.2M9 20h.01M18 20h.01',
  gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9S10 4 7.5 5.5 9 9 12 9zm0 0s2-5 4.5-3.5S15 9 12 9z',
  chat: 'M4 5h16v11H8l-4 4z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  id: 'M3 5h18v14H3zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 16a3 3 0 0 1 6 0M14 9h4M14 13h4',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6M5 21h14v-3H5zM12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4',
  clipboard: 'M8 4h8v3H8zM6 5H5v16h14V5h-1M9 13l2 2 4-4',
  family: 'M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a5 5 0 0 1 10 0M12 20a5 5 0 0 1 10 0',
  senior: 'M12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 22l1-7-2-2V10a4 4 0 0 1 8 0v3M17 13v9M14 13h3',
  walk: 'M13 4a2 2 0 1 0 0-.01M10 21l2-6 3 3v3M8 12l3-4 3 2 3 1M11 8l-1 5',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  money: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  menu: 'M4 6h16M4 12h16M4 18h16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  drip: 'M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z',
  attendant: 'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 22v-4a7 7 0 0 1 14 0v4M9 14l3 3 3-3',
  physio: 'M14 4a2 2 0 1 0 0-.01M4 20l5-5 3 2 4-6 4 1M9 15l1-5 4-1',
  doctor: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0M16 15v3a2 2 0 0 0 4 0v-1',
  lab: 'M9 3h6M10 3v6L5 19a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3M7 15h10',
  escort: 'M8 5a2 2 0 1 0 0-.01M16 5a2 2 0 1 0 0-.01M5 21l2-8 1-3h0l2 3M19 21l-2-8-1-3-2 3M10 13h4',
  companion: 'M8 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a5 5 0 0 1 10 0M15 8h6v5h-3l-3 2z',
  errand: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  document: 'M6 3h9l4 4v14H6zM9 13h7M9 17h4',
  check2: 'M9 11l3 3 8-8M20 12v7H4V5h11',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
};
export function icon(name, size = 24, sw = 2) {
  const d = P[name] || P.info;
  return raw(`<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`);
}

const TZ = 'Asia/Kolkata';
const loc = () => (lang() === 'hi' ? 'hi-IN' : 'en-IN');
export function fmtTime(ts, tz = TZ) { return new Date(ts).toLocaleTimeString(loc(), { timeZone: tz, hour: 'numeric', minute: '2-digit' }); }
export function fmtDate(ts, tz = TZ) { return new Date(ts).toLocaleDateString(loc(), { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }); }
export function fmtDateTime(ts, tz = TZ) { return `${fmtDate(ts, tz)}, ${fmtTime(ts, tz)}`; }
export function fmtDay(ts, now) {
  const k = (x) => new Date(x + 330 * 60000).toISOString().slice(0, 10);
  const d = k(ts), n = k(now), y = k(now - 864e5), tm = k(now + 864e5);
  if (d === n) return t('Today');
  if (d === tm) return t('Tomorrow');
  if (d === y) return t('Yesterday');
  return fmtDate(ts);
}
export function ago(ts, now) {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return t('just now');
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${t('min ago')}`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} ${t('h ago')}`;
  return fmtDate(ts);
}
export function money(n) { return '₹' + Math.round(n || 0).toLocaleString('en-IN'); }
export function stars(n) { if (n == null) return ''; const f = Math.round(n); return '★'.repeat(f) + '☆'.repeat(5 - f); }
export function initials(name) { return String(name || '?').replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s*/, '').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase(); }

export const STATUS = {
  pending_approval: ['Needs approval', 'amber'], requested: ['Waiting for provider', 'info'], accepted: ['Accepted', 'info'], assigned: ['Caregiver assigned', 'brand'],
  in_progress: ['Visit in progress', 'green'], completed: ['Done: please confirm', 'amber'], confirmed: ['Confirmed', 'green'], paid_out: ['Completed', 'green'],
  declined: ['Declined, refunded', 'red'], expired: ['Not accepted, refunded', 'red'], cancelled: ['Cancelled', ''], no_show: ['No-show, refunded', 'red'], disputed: ['Issue raised', 'red'],
};
export function statusBadge(s) { const [l, c] = STATUS[s] || [s, '']; return h`<span class="badge ${c}">${t(l)}</span>`; }
export function bandBadge(band, score) {
  if (!band) return '';
  const c = { excellent: 'green', good: 'brand', fair: 'amber', review: 'red', new: '' }[band.key];
  return h`<span class="badge ${c}" title="Quality score ${score ?? 'new'}">${icon('shield', 14)} ${t(band.label)}${score != null ? ` · ${score}` : ''}</span>`;
}

let toastTimer;
export function toast(msg, err = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.setAttribute('role', err ? 'alert' : 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), err ? 6000 : 3800);
}

export function modal(content, mount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="iconbtn x" data-close aria-label="${esc(t('Close'))}">${str(icon('x'))}</button>${str(content)}</div>`;
  const prev = document.activeElement;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  const m = bg.querySelector('.modal');
  (m.querySelector('input,select,textarea,button:not([data-close])') || m).focus();
  mount?.(m, close);
  return close;
}

export function confirmBox(text, { ok = t('Yes'), cancel = t('No'), danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(h`<h2>${text}</h2><div class="btn-row" style="margin-top:1rem"><button class="btn ghost" data-no>${cancel}</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${ok}</button></div>`, (m) => {
      m.querySelector('[data-yes]').onclick = () => { done = true; close(); resolve(true); };
      m.querySelector('[data-no]').onclick = () => { done = true; close(); resolve(false); };
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(document.querySelector('.modal-bg')) && !done) { obs.disconnect(); resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi) { (o[el.name] ||= []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

/** Read text aloud in the user's language (FR-NTF-04, senior voice prompts). */
export function speak(text) {
  try {
    const s = window.speechSynthesis;
    if (!s) { toast(t('Voice is not available on this device')); return; }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang() === 'hi' ? 'hi-IN' : 'en-IN';
    u.rate = 0.9;
    s.speak(u);
  } catch { /* ignore */ }
}

/** Minimal accessible SVG line chart. series: [{name, color, points:[{x,y}]}] */
export function lineChart(series, { height = 180, yMin, yMax, bands = [], fmtX = (x) => new Date(x).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), label = 'Chart' } = {}) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return h`<p class="muted">${t('No readings yet')}</p>`;
  const W = 600, H = height, L = 36, R = 10, T = 10, B = 24;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const lo = yMin ?? Math.floor(Math.min(...ys) * 0.9), hi = yMax ?? Math.ceil(Math.max(...ys) * 1.1);
  const X = (x) => L + ((x - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (y) => T + (1 - (y - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const ticks = 4;
  let g = '';
  for (const b of bands) g += `<rect x="${L}" width="${W - L - R}" y="${Y(b.to)}" height="${Math.max(0, Y(b.from) - Y(b.to))}" fill="${b.color}" opacity=".12"/>`;
  for (let i = 0; i <= ticks; i++) { const v = lo + ((hi - lo) * i) / ticks; g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke-dasharray="2 3"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  const uniqX = [...new Set(xs)].sort((a, b) => a - b);
  const step = Math.ceil(uniqX.length / 6);
  const last = uniqX.length - 1;
  const idx = new Set(uniqX.map((_, i) => i).filter((i) => i % step === 0));
  if (!idx.has(last)) { const prev = last - (last % step); if (last - prev < step / 2) idx.delete(prev); idx.add(last); }
  uniqX.forEach((x, i) => { if (idx.has(i)) g += `<text x="${X(x)}" y="${H - 6}" text-anchor="${i === last && i ? 'end' : i === 0 ? 'start' : 'middle'}">${esc(fmtX(x))}</text>`; });
  for (const s of series) {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (const p of s.points) g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.5" fill="${s.color}"><title>${esc(s.name)}: ${p.y} (${esc(fmtX(p.x))})</title></circle>`;
  }
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  return raw(`<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}</svg><div class="legend">${legend}</div></div>`);
}

export function barList(rows, { max } = {}) {
  const m = max || Math.max(1, ...rows.map((r) => r.value));
  return h`<div class="stack">${rows.map((r) => h`<div><div class="row between"><span>${r.label}</span><strong>${r.display ?? r.value}</strong></div><div class="bar"><span style="width:${Math.round((r.value / m) * 100)}%;${r.color ? `background:${r.color}` : ''}"></span></div></div>`)}</div>`;
}

export function empty(text, action) {
  return h`<div class="card flat" style="text-align:center;padding:28px"><p class="muted">${text}</p>${action || ''}</div>`;
}

/** In-page text prompt (window.prompt is blocked in embedded viewers). Resolves to the text, or null. */
export function askText(label, { value = '', ok = t('Save') } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(h`<h2>${label}</h2><form id="ask"><textarea id="ask-text" rows="3">${value}</textarea><button class="btn block" style="margin-top:12px">${ok}</button></form>`, (m) => {
      m.querySelector('#ask').onsubmit = (e) => { e.preventDefault(); done = true; const v = m.querySelector('#ask-text').value.trim(); close(); resolve(v || null); };
    });
    const iv = setInterval(() => { if (!document.querySelector('.modal-bg')) { clearInterval(iv); if (!done) resolve(null); } }, 300);
  });
}

/**
 * Single-tab-stop date and time fields for fast keyboard data entry.
 *
 * Native <input type="date|time"> in Chromium consumes several Tab stops
 * (day / month / year segments plus the picker button), which slows down
 * reception staff. These fields accept typed values in several formats,
 * support ArrowUp / ArrowDown to adjust, and keep a canonical value in
 * data-value (YYYY-MM-DD or HH:MM). Mouse users still get the native picker
 * through a calendar button that is deliberately not a Tab stop.
 */
import { todayIso } from './format.js';

const pad = (n) => String(n).padStart(2, '0');

function isoFromParts(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parseDate(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 't' || s === 'today') return todayIso();
  if (s === 'tomorrow' || s === 'tm') return todayIso(1);
  let m = /^\+(\d{1,3})$/.exec(s);
  if (m) return addDaysIso(todayIso(), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(s);
  if (m) return isoFromParts(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (m) return isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export const formatDate = (iso) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');

export function parseTime(text) {
  const s = String(text || '').trim().toLowerCase().replace(/\./g, ':');
  if (!s) return null;
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${pad(h % 12 || 12)}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

function attachPicker(input, type, onPick) {
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  input.replaceWith(wrap);
  wrap.appendChild(input);
  input.style.paddingRight = '40px';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.tabIndex = -1;
  btn.className = 'btn ghost sm icon';
  btn.setAttribute('aria-hidden', 'true');
  btn.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%)';
  btn.innerHTML = type === 'date'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
  const native = document.createElement('input');
  native.type = type;
  native.tabIndex = -1;
  native.setAttribute('aria-hidden', 'true');
  native.style.cssText = 'position:absolute;right:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none';
  wrap.append(btn, native);
  btn.addEventListener('click', () => {
    native.value = input.dataset.value || '';
    try { native.showPicker(); } catch { native.focus(); native.click(); }
  });
  native.addEventListener('change', () => { onPick(native.value); input.focus(); });
}

export function dateField(input, { value = todayIso() } = {}) {
  input.type = 'text';
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('autocomplete', 'off');
  input.placeholder = 'DD-MM-YYYY';
  const set = (iso, fire = true) => {
    input.dataset.value = iso || '';
    input.value = formatDate(iso);
    if (fire) input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      set(addDaysIso(parseDate(input.value) || todayIso(), e.key === 'ArrowUp' ? 1 : -1));
    }
  });
  input.addEventListener('blur', () => {
    const iso = parseDate(input.value);
    if (iso) { if (formatDate(iso) !== input.value) set(iso); else input.dataset.value = iso; } else input.dataset.value = '';
  });
  attachPicker(input, 'date', set);
  set(value, false);
  return { get: () => parseDate(input.value), set };
}

export function timeField(input, { value } = {}) {
  input.type = 'text';
  input.setAttribute('autocomplete', 'off');
  input.placeholder = 'HH:MM AM';
  const set = (hhmm, fire = true) => {
    input.dataset.value = hhmm || '';
    input.value = formatTime(hhmm);
    if (fire) input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseTime(input.value) || '09:00';
      let [h, m] = cur.split(':').map(Number);
      let t = h * 60 + m + (e.key === 'ArrowUp' ? 15 : -15);
      t = (t + 1440) % 1440;
      h = Math.floor(t / 60); m = t % 60;
      set(`${pad(h)}:${pad(m)}`);
    }
  });
  input.addEventListener('blur', () => {
    const v = parseTime(input.value);
    if (v) { if (formatTime(v) !== input.value) set(v); else input.dataset.value = v; } else input.dataset.value = '';
  });
  attachPicker(input, 'time', set);
  set(value || null, false);
  return { get: () => parseTime(input.value), set };
}

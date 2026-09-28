import { html } from './dom.js';
import { tz } from './state.js';

const pad = (n) => String(n).padStart(2, '0');

function parts(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { y: g('year'), m: g('month'), d: g('day'), h: Number(g('hour')) % 24, min: g('minute') };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 28-09-2026 */
export function fmtDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}-${m}-${y}`;
  }
  const p = parts(value);
  return p ? `${p.d}-${p.m}-${p.y}` : '';
}

/** 18 September 2026 */
export function fmtLongDate(value) {
  if (!value) return '';
  let y; let m; let d;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) [y, m, d] = value.split('-');
  else { const p = parts(value); if (!p) return ''; ({ y, m, d } = p); }
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** 10:32 AM */
export function fmtTime(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    return `${pad(h % 12 || 12)}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const p = parts(value);
  return p ? `${pad(p.h % 12 || 12)}:${p.min} ${p.h < 12 ? 'AM' : 'PM'}` : '';
}

export const fmtDateTime = (v) => (v ? `${fmtDate(v)} ${fmtTime(v)}` : '');

/** 01:46 */
export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined || minutes === '') return '';
  const m = Math.max(0, Math.round(Number(minutes)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** 1 hr 46 min */
export function fmtDurationWords(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const m = Math.max(0, Math.round(Number(minutes)));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} hr ${r} min` : `${h} hr${h > 1 ? 's' : ''}`;
}

export function relativeTime(value) {
  const d = new Date(value);
  const diff = Math.round((Date.now() - d.getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  if (diff < 24 * 60) return `${Math.floor(diff / 60)} hr ago`;
  return fmtDateTime(value);
}

/** YYYY-MM-DD for today in the organisation time zone. */
export function todayIso(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function nowTimeHHMM() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

export const STATUS_LABELS = {
  EXPECTED: 'Expected', PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved', CHECKED_IN: 'Checked-In',
  CHECKED_OUT: 'Checked-Out', DENIED: 'Denied', CANCELLED: 'Cancelled', OVERSTAY: 'Overstay',
};

export const statusBadge = (s) => html`<span class="status ${s}">${STATUS_LABELS[s] || s}</span>`;

export function maskMobile(n) {
  if (!n) return '';
  const s = String(n);
  return s.length <= 2 ? s : 'X'.repeat(s.length - 2) + s.slice(-2);
}

export const fmtMobile = (cc, n, masked = false) => (n ? `${cc || ''} ${masked ? maskMobile(n) : n}`.trim() : '');

export function fmtNumber(n) {
  return new Intl.NumberFormat('en-IN').format(n ?? 0);
}

export function durationOptions(max = 480) {
  const opts = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 600, 720].filter((m) => m <= max);
  const label = (m) => {
    if (m < 60) return `${m} minutes`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h} hour${h > 1 ? 's' : ''}${r ? ` ${r} minutes` : ''}`;
  };
  return opts.map((m) => ({ value: m, label: label(m) }));
}

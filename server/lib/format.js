/** Server-side formatting for exports and PDFs, in the organisation time zone. */

const pad = (n) => String(n).padStart(2, '0');

function parts(tz, value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { y: g('year'), m: g('month'), d: g('day'), h: Number(g('hour')) % 24, min: g('minute') };
}

export function fmtDate(tz, value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}-${m}-${y}`;
  }
  const p = parts(tz, value);
  return p ? `${p.d}-${p.m}-${p.y}` : '';
}

export function fmtTime(tz, value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{2}:\d{2}/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    return `${pad(h % 12 || 12)}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const p = parts(tz, value);
  if (!p) return '';
  return `${pad(p.h % 12 || 12)}:${p.min} ${p.h < 12 ? 'AM' : 'PM'}`;
}

export const fmtDateTime = (tz, value) => (value ? `${fmtDate(tz, value)} ${fmtTime(tz, value)}` : '');

export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined || minutes === '') return '';
  const m = Math.max(0, Math.round(Number(minutes)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export const STATUS_TEXT = {
  EXPECTED: 'Expected', PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved', CHECKED_IN: 'Checked-In',
  CHECKED_OUT: 'Checked-Out', DENIED: 'Denied', CANCELLED: 'Cancelled', OVERSTAY: 'Overstay',
};

export function formatCell(tz, type, value) {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'date': return fmtDate(tz, value);
    case 'time': return fmtTime(tz, value);
    case 'datetime': return fmtDateTime(tz, value);
    case 'duration': return fmtDuration(value);
    case 'status': return STATUS_TEXT[value] || String(value);
    case 'number': return typeof value === 'number' ? value : Number(value);
    default: return String(value);
  }
}

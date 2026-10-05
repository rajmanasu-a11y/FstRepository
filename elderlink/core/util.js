// Small helpers shared by the engine. Pure functions, no I/O, run in Node and the browser.

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
const IST_OFFSET = 330 * MIN; // India has no daylight saving

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}
export const fail = (status, message, code) => { throw new ApiError(status, message, code); };
export const assert = (cond, status, message, code) => { if (!cond) fail(status, message, code); };

export function round2(n) { return Math.round(n * 100) / 100; }
export function rupees(n) { return Math.round(n); }

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Calendar date in India for a timestamp, as YYYY-MM-DD. */
export function istDateKey(ts) {
  return new Date(ts + IST_OFFSET).toISOString().slice(0, 10);
}
/** Minutes since midnight in India. */
export function istMinutes(ts) {
  const d = new Date(ts + IST_OFFSET);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
/** Timestamp of a wall-clock time ("08:30") in India on a given date key. */
export function istTime(dateKey, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return Date.parse(`${dateKey}T00:00:00Z`) - IST_OFFSET + (h * 60 + m) * MIN;
}
export function addDaysKey(dateKey, n) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
export function weekdayOfKey(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}
export function ageFromDob(dob, now) {
  const d = new Date(dob);
  const n = new Date(now);
  let age = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export function randomDigits(n, rnd = Math.random) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(rnd() * 10);
  return s;
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function avg(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

export function normaliseMobile(m) {
  const digits = String(m || '').replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(digits)) return '+91' + digits;
  if (/^91\d{10}$/.test(digits)) return '+' + digits;
  return digits.startsWith('+') ? digits : '+' + digits;
}

/** Deterministic pseudo-random generator so seed data is the same on every reset. */
export function seededRandom(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

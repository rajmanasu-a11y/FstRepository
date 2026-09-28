/**
 * Date helpers that work in the organisation's time zone.
 * All persisted timestamps are UTC; "today", date ranges and report dates are
 * interpreted in the organisation time zone.
 */

/** 'YYYY-MM-DD' for the given instant in the given time zone. */
export function localDate(tz, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localYear(tz, at = new Date()) {
  return Number(localDate(tz, at).slice(0, 4));
}

/** 'HH:MM' for the given instant in the given time zone. */
export function localTime(tz, at = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Resolve a named period into an inclusive [from, to] local date range. */
export function periodRange(period, tz, from, to) {
  const today = localDate(tz);
  switch (period) {
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'week': {
      // ISO week (Monday start).
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
      return { from: addDays(today, 1 - dow), to: today };
    }
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last30': return { from: addDays(today, -29), to: today };
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      if (from && to) return from <= to ? { from, to } : { from: to, to: from };
      return { from: from || to || today, to: to || from || today };
    case 'today':
    default:
      return { from: today, to: today };
  }
}

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

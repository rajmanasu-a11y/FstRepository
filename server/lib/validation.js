import { z } from 'zod';
import { validationError } from './errors.js';

/** Parse input with a zod schema, converting issues into a field -> message map. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw validationError(fields);
}

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Optional free text: trims, converts '' to null, caps length. */
export const optText = (max = 200) =>
  z.preprocess(emptyToNull, z.string().trim().max(max, `Must be ${max} characters or fewer`).nullable().optional());

export const reqText = (label, max = 200, min = 1) =>
  z.string({ error: `${label} is required` })
    .trim()
    .min(min, min > 1 ? `${label} must be at least ${min} characters` : `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

export const optId = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.number().int().positive().nullable().optional(),
);
export const reqId = (label) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number({ error: `${label} is required` }).int().positive(`${label} is required`));

export const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional();

// Names: must contain letters; allow common punctuation used in names.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s.'\-()]*$/u;
export const personName = (label = 'Name') =>
  z.string({ error: `${label} is required` })
    .trim()
    .transform((v) => v.replace(/\s+/g, ' '))
    .pipe(
      z.string()
        .min(2, `${label} must be at least 2 characters`)
        .max(120, `${label} must be 120 characters or fewer`)
        .regex(NAME_RE, `${label} must contain letters only (numbers are not allowed)`),
    );

export const countryCode = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().replace(/^(\d)/, '+$1') : v),
  z.string().regex(/^\+[0-9]{1,4}$/, 'Select a valid country code'),
);

export function normaliseMobile(v) {
  return typeof v === 'string' ? v.replace(/[\s\-().]/g, '').replace(/^0+/, '') : v;
}

/** Validates a national mobile number for the given country code. Returns an error message or null. */
export function mobileProblem(cc, number) {
  if (!/^[0-9]+$/.test(number)) return 'Mobile number must contain digits only';
  if (cc === '+91') {
    if (!/^[6-9][0-9]{9}$/.test(number)) return 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9';
  } else if (number.length < 6 || number.length > 14) {
    return 'Enter a valid mobile number (6 to 14 digits)';
  }
  if (/^(\d)\1+$/.test(number)) return 'This mobile number does not appear to be valid';
  if (number.length >= 8 && '01234567890123456789'.includes(number)) {
    return 'This mobile number does not appear to be valid';
  }
  return null;
}

export const email = z.preprocess(
  emptyToNull,
  z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address')).nullable().optional(),
);

export const isoDate = (label) =>
  z.string({ error: `${label} is required` }).regex(/^\d{4}-\d{2}-\d{2}$/, `Enter a valid ${label.toLowerCase()}`)
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), `Enter a valid ${label.toLowerCase()}`);

export const optTime = z.preprocess(
  emptyToNull,
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Enter a valid time (HH:MM)').nullable().optional(),
);

export const vehicleNumber = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.toUpperCase().replace(/\s+/g, '')) : v),
  z.string().regex(/^[A-Z0-9-]{4,15}$/, 'Enter a valid vehicle registration number (letters and digits only)').nullable().optional(),
);

export const pageParams = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
});

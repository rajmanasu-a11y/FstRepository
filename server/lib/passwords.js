import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

// Format: scrypt$N$r$p$saltB64$hashB64
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// A precomputed hash used to keep login timing uniform for unknown usernames.
let dummyHash;
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
  return false;
}

export function checkPasswordPolicy(password, policy) {
  const problems = [];
  const min = policy?.passwordMinLength ?? 10;
  if (typeof password !== 'string' || password.length < min) problems.push(`at least ${min} characters`);
  if (policy?.passwordRequireComplexity !== false) {
    if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
    if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
    if (!/[0-9]/.test(password)) problems.push('a number');
    if (!/[^A-Za-z0-9]/.test(password)) problems.push('a special character');
  }
  if (typeof password === 'string' && password.length > 128) problems.push('no more than 128 characters');
  return problems.length ? `Password must contain ${problems.join(', ')}.` : null;
}

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProduction: env === 'production',
  port: int('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgres://vms:vms@localhost:5432/vms',
  dbPoolMax: int('DB_POOL_MAX', 20),
  // Base URL embedded in QR codes (so a phone camera scan opens the record).
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Secure cookies require HTTPS. Enabled by default in production.
  secureCookies: process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === 'true' : env === 'production',
  trustProxy: process.env.TRUST_PROXY || 'loopback',
  storageDir: path.resolve(root, process.env.STORAGE_DIR || 'storage'),
  maxUploadBytes: int('MAX_UPLOAD_BYTES', 5 * 1024 * 1024),
  loginRateLimitPerWindow: int('LOGIN_RATE_LIMIT', 20),
  apiRateLimitPerMinute: int('API_RATE_LIMIT', 600),
  backgroundJobs: process.env.BACKGROUND_JOBS !== 'false',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: int('SMTP_PORT', 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  root,
  publicDir: path.join(root, 'public'),
};

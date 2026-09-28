import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { loadSession, requireAuth, csrfProtection } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { visitorsRouter, photoUploadHandler } from './routes/visitors.js';
import { visitsRouter, preRegister, verifyToken, listApprovals } from './routes/visits.js';
import { employeesRouter, companiesRouter, mastersRouter } from './routes/directory.js';
import { reportsRouter } from './routes/reports.js';
import { dashboardRouter } from './routes/dashboard.js';
import { usersRouter, settingsRouter, auditRouter, notificationsRouter, filesRouter, retentionRouter } from './routes/admin.js';
import { printRouter } from './routes/print.js';
import { requirePermission } from './middleware/auth.js';
import { query } from './db/pool.js';
import { AppError } from './lib/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'"],
        'font-src': ["'self'", 'data:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': config.secureCookies ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.secureCookies ? undefined : false,
  }));
  // Camera access is needed for visitor photographs on the same origin only.
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    next();
  });
  app.use(compression());
  app.use(cookieParser());

  // ---- API ---------------------------------------------------------------
  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use(rateLimit({
    windowMs: 60_000,
    limit: config.apiRateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } },
  }));
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(loadSession);
  api.use(csrfProtection);

  api.get('/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  api.use('/auth', authRouter);
  api.use('/files', filesRouter);

  // Everything below requires an authenticated session.
  api.use(requireAuth);
  // Accounts with a temporary password may only change it (and sign out).
  api.use((req, _res, next) => {
    if (req.user.mustChangePassword && !['/notifications/unread-count'].includes(req.path)) {
      return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please change your temporary password before continuing.'));
    }
    next();
  });
  api.use('/visitors', visitorsRouter);
  api.post('/photos', ...photoUploadHandler);
  api.use('/visits', visitsRouter);
  api.post('/pre-registration', preRegister);
  api.get('/approvals', requirePermission('visit.approve_own', 'visit.approve_any'), listApprovals);
  api.get('/verify/:token', requirePermission('security.verify', 'visit.checkin'), verifyToken);
  api.use('/employees', employeesRouter);
  api.use('/companies', companiesRouter);
  api.use('/masters', mastersRouter);
  api.use('/reports', reportsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/users', usersRouter);
  api.use('/settings', settingsRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/retention', retentionRouter);
  api.use('/print', printRouter);
  api.use(notFoundHandler);

  app.use('/api', api);

  // ---- Static single-page application -------------------------------------
  app.use(express.static(config.publicDir, {
    index: false,
    setHeaders(res, filePath) {
      res.set('Cache-Control', /\.(js|css|svg|woff2?)$/.test(filePath) ? 'no-cache' : 'public, max-age=3600');
    },
  }));
  // History-API fallback: application routes (no file extension) return the app shell;
  // missing static assets get a real 404 instead of HTML.
  app.get(/^\/(?!api\/)(?!.*\.[a-z0-9]{2,5}$).*/i, (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

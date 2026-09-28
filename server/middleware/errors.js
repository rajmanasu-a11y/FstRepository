import crypto from 'node:crypto';
import multer from 'multer';
import { AppError, fromDatabaseError } from '../lib/errors.js';
import { query } from '../db/pool.js';

export const GENERIC_ERROR = 'Unable to complete the request. Please try again or contact the system administrator.';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } });
}

// eslint-disable-next-line no-unused-vars
export async function errorHandler(err, req, res, _next) {
  let appErr = err instanceof AppError ? err : fromDatabaseError(err);

  if (!appErr && err instanceof multer.MulterError) {
    appErr = err.code === 'LIMIT_FILE_SIZE'
      ? new AppError(413, 'FILE_TOO_LARGE', 'The selected file is too large. Please choose a smaller file.')
      : new AppError(400, 'UPLOAD_REJECTED', 'The file upload could not be accepted.');
  }
  if (!appErr && (err.type === 'entity.too.large')) {
    appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
  }
  if (!appErr && (err.type === 'entity.parse.failed')) {
    appErr = new AppError(400, 'BAD_REQUEST', 'The request could not be read.');
  }

  if (appErr) {
    const body = { error: { code: appErr.code, message: appErr.message } };
    if (appErr.fields) body.error.fields = appErr.fields;
    if (appErr.details) body.error.details = appErr.details;
    return res.status(appErr.status).json(body);
  }

  // Unexpected failure: log the technical detail securely, show a generic message.
  const reference = `ERR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  console.error(`[error] ${reference} ${req.method} ${req.originalUrl}`, err);
  try {
    await query(
      `INSERT INTO error_logs (reference, user_id, method, path, message, stack, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [reference, req.user?.id ?? null, req.method, req.originalUrl.slice(0, 500), String(err?.message || err).slice(0, 2000),
        String(err?.stack || '').slice(0, 8000), JSON.stringify({ code: err?.code ?? null })],
    );
  } catch (logErr) {
    console.error('[error] failed to persist error log', logErr.message);
  }
  if (res.headersSent) return;
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: GENERIC_ERROR, reference } });
}

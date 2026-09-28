import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { AppError, notFound } from '../lib/errors.js';

const ALLOWED_INPUT = new Set(['jpeg', 'png', 'webp']);

// Protect against decompression bombs: reject images with absurd pixel counts.
const MAX_INPUT_PIXELS = 40_000_000;

function storagePath(key) {
  const full = path.resolve(config.storageDir, key);
  if (!full.startsWith(path.resolve(config.storageDir) + path.sep)) throw new Error('Invalid storage key');
  return full;
}

async function inspect(buffer) {
  try {
    const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
    if (!ALLOWED_INPUT.has(meta.format)) throw new Error('format');
    return meta;
  } catch {
    throw new AppError(415, 'UNSUPPORTED_FILE', 'Only JPEG, PNG or WebP images are accepted. Please choose a valid photograph.');
  }
}

async function persist(buffer, { purpose, mime, ext, width, height, originalName, userId }) {
  const now = new Date();
  const key = `${purpose === 'ORG_LOGO' ? 'branding' : 'photos'}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
  const full = storagePath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { mode: 0o640 });
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const { rows } = await query(
    `INSERT INTO stored_files (purpose, storage_key, mime_type, size_bytes, width, height, sha256, original_name, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, size_bytes, width, height`,
    [purpose, key, mime, buffer.length, width, height, sha256, originalName?.slice(0, 200) || null, userId],
  );
  return rows[0];
}

/**
 * Validate, normalise and store a visitor photograph. Every upload is
 * re-encoded (which strips EXIF/GPS metadata and any embedded payload),
 * auto-rotated, cropped to a 3:4 portrait and compressed to a small JPEG.
 */
export async function storeVisitorPhoto(buffer, { originalName, userId }) {
  await inspect(buffer);
  const out = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(360, 480, { fit: 'cover', position: 'attention' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return persist(out.data, {
    purpose: 'VISITOR_PHOTO', mime: 'image/jpeg', ext: 'jpg', width: out.info.width, height: out.info.height, originalName, userId,
  });
}

export async function storeLogo(buffer, { originalName, userId }) {
  await inspect(buffer);
  const out = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize(600, 240, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  return persist(out.data, {
    purpose: 'ORG_LOGO', mime: 'image/png', ext: 'png', width: out.info.width, height: out.info.height, originalName, userId,
  });
}

export async function getFile(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw notFound();
  const { rows } = await query('SELECT * FROM stored_files WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

export async function readFileBuffer(file) {
  try {
    return await fs.readFile(storagePath(file.storage_key));
  } catch {
    throw notFound('The file is no longer available.');
  }
}

/**
 * Mark a stored file deleted inside a transaction and return its storage key.
 * Remove the bytes with removeFromDisk() only AFTER the transaction commits,
 * so a rollback never leaves the database pointing at a missing file.
 */
export async function markFileDeleted(client, id) {
  const { rows } = await client.query(
    'UPDATE stored_files SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING storage_key', [id],
  );
  return rows[0]?.storage_key ?? null;
}

export async function removeFromDisk(keys) {
  for (const key of [].concat(keys).filter(Boolean)) await fs.rm(storagePath(key), { force: true });
}

export async function deleteStoredFile(id) {
  const key = await markFileDeleted({ query }, id);
  await removeFromDisk(key);
}

/** Remove uploads that were never attached to a visitor (abandoned registrations). */
export async function purgeUnattachedUploads(hours = 24) {
  const { rows } = await query(
    `SELECT id FROM stored_files WHERE is_attached = FALSE AND deleted_at IS NULL AND purpose = 'VISITOR_PHOTO'
       AND created_at < now() - make_interval(hours => $1)`, [hours],
  );
  for (const r of rows) await deleteStoredFile(r.id);
  return rows.length;
}

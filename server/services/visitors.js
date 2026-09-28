import { query } from '../db/pool.js';
import { conflict, notFound, validationError, forbidden } from '../lib/errors.js';
import { audit, diff } from './audit.js';
import { getSetting } from './settings.js';

/** Mask an identity reference, keeping only the last four characters. */
export function maskReference(ref) {
  if (!ref) return ref;
  const s = String(ref).replace(/\s+/g, '');
  if (s.length <= 4) return 'X'.repeat(s.length);
  return 'X'.repeat(Math.min(s.length - 4, 8)) + s.slice(-4);
}

export function maskMobile(number) {
  if (!number) return number;
  const s = String(number);
  return s.length <= 2 ? s : 'X'.repeat(s.length - 2) + s.slice(-2);
}

const VISITOR_SELECT = `
  v.id, v.visitor_code, v.full_name, v.mobile_country_code, v.mobile_number, v.alternate_contact,
  v.email::text AS email, v.company_id, c.name AS company_name, v.designation, v.address,
  v.id_type_id, it.name AS id_type_name, v.id_reference, v.photo_file_id,
  v.watchlist_status, v.watchlist_reason, v.record_status,
  v.first_visit_at, v.last_visit_at, v.total_visits, v.created_at, v.updated_at`;

const LAST_VISIT_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT lv.id AS last_visit_id, lv.visit_code AS last_visit_code, lv.appointment_date AS last_visit_date,
           lv.check_in_at AS last_check_in_at, lv.host_employee_id AS last_host_id,
           lv.host_name_snapshot AS last_host_name, lv.host_designation_snapshot AS last_host_designation,
           ld.name AS last_department, lp.name AS last_purpose, lv.purpose_other AS last_purpose_other,
           lv.purpose_id AS last_purpose_id, lv.category_id AS last_category_id, lv.access_area_id AS last_access_area_id,
           lv.status AS last_status
      FROM visits lv
      JOIN departments ld ON ld.id = lv.department_id
      JOIN purposes lp ON lp.id = lv.purpose_id
     WHERE lv.visitor_id = v.id AND lv.status NOT IN ('CANCELLED')
     ORDER BY coalesce(lv.check_in_at, lv.created_at) DESC
     LIMIT 1
  ) last ON TRUE`;

export function shapeVisitor(r) {
  if (!r) return null;
  return {
    id: r.id,
    visitorCode: r.visitor_code,
    fullName: r.full_name,
    mobileCountryCode: r.mobile_country_code,
    mobileNumber: r.mobile_number,
    alternateContact: r.alternate_contact,
    email: r.email,
    companyId: r.company_id,
    companyName: r.company_name,
    designation: r.designation,
    address: r.address,
    idTypeId: r.id_type_id,
    idTypeName: r.id_type_name,
    idReference: r.id_reference,
    photoUrl: r.photo_file_id ? `/api/files/photos/${r.photo_file_id}` : null,
    photoFileId: r.photo_file_id,
    watchlistStatus: r.watchlist_status,
    watchlistReason: r.watchlist_reason,
    recordStatus: r.record_status,
    firstVisitAt: r.first_visit_at,
    lastVisitAt: r.last_visit_at,
    totalVisits: r.total_visits,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.last_visit_id !== undefined ? {
      lastVisit: r.last_visit_id ? {
        id: r.last_visit_id,
        visitCode: r.last_visit_code,
        date: r.last_visit_date,
        checkInAt: r.last_check_in_at,
        hostId: r.last_host_id,
        hostName: r.last_host_name,
        hostDesignation: r.last_host_designation,
        department: r.last_department,
        purposeId: r.last_purpose_id,
        purpose: r.last_purpose_other ? `${r.last_purpose} – ${r.last_purpose_other}` : r.last_purpose,
        categoryId: r.last_category_id,
        accessAreaId: r.last_access_area_id,
        status: r.last_status,
      } : null,
    } : {}),
    ...(r.rank !== undefined ? { matchedOn: r.matched_on } : {}),
  };
}

/**
 * Server-side returning-visitor search. The query shape is chosen from the
 * input so that each branch can use an index:
 *   digits           -> mobile prefix (btree text_pattern_ops) / contains (trigram)
 *   email            -> email equality / prefix
 *   VIS-/VST-/PASS-  -> exact code lookups (unique indexes)
 *   free text        -> tsvector prefix match (GIN) + trigram name / company match
 * Results are ranked by match quality, then recency of last visit.
 */
export async function searchVisitors(rawQuery, { limit = 10, offset = 0, includeInactive = false } = {}) {
  const q = String(rawQuery || '').trim().slice(0, 100);
  if (q.length < 2) return { items: [], total: 0 };

  const statusFilter = includeInactive ? `v.record_status <> 'ANONYMISED'` : `v.record_status = 'ACTIVE'`;
  const digits = q.replace(/[\s\-+()]/g, '');
  let where;
  let rank;
  let matchedOn;
  const params = [];

  // A scanned QR code (URL ending in /verify/<token>) or a bare 32-character token.
  const urlToken = q.match(/verify\/([A-Za-z0-9_-]{20,64})/)?.[1];
  const bareToken = /^[A-Za-z0-9_-]{32}$/.test(q) && /\d/.test(q) && /[A-Za-z]/.test(q) ? q : null;
  const token = urlToken || bareToken;

  if (/^(VIS|VST|PASS)-/i.test(q)) {
    params.push(q.toUpperCase());
    where = `(v.visitor_code = $1
              OR v.id IN (SELECT visitor_id FROM visits WHERE visit_code = $1)
              OR v.id IN (SELECT vi.visitor_id FROM visitor_passes p JOIN visits vi ON vi.id = p.visit_id WHERE p.pass_number = $1))`;
    rank = '100';
    matchedOn = `'reference'`;
  } else if (token) {
    params.push(token);
    where = `v.id IN (SELECT visitor_id FROM visits WHERE qr_token = $1)`;
    rank = '100';
    matchedOn = `'qr'`;
  } else if (/^\d{3,15}$/.test(digits)) {
    // Drop a leading country code typed with the number (e.g. 919876543210).
    const national = digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits;
    params.push(national);
    where = `(v.mobile_number LIKE $1 || '%' OR v.mobile_number LIKE '%' || $1 || '%' OR v.id_reference = $1
              OR v.alternate_contact LIKE '%' || $1 || '%')`;
    rank = `CASE WHEN v.mobile_number = $1 THEN 100 WHEN v.mobile_number LIKE $1 || '%' THEN 60
                 WHEN v.id_reference = $1 THEN 55 ELSE 30 END`;
    matchedOn = `CASE WHEN v.mobile_number LIKE '%' || $1 || '%' THEN 'mobile' WHEN v.id_reference = $1 THEN 'idReference' ELSE 'alternateContact' END`;
  } else if (q.includes('@')) {
    params.push(q.toLowerCase());
    where = `(v.email = $1 OR v.email::text LIKE $1 || '%')`;
    rank = `CASE WHEN v.email = $1 THEN 100 ELSE 50 END`;
    matchedOn = `'email'`;
  } else {
    const tokens = q.toLowerCase().replace(/[^\p{L}\p{N}\s.-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
    if (!tokens.length) return { items: [], total: 0 };
    const tsq = tokens.map((t) => `${t.replace(/[^\p{L}\p{N}]/gu, '')}:*`).filter((t) => t !== ':*').join(' & ');
    params.push(q, tsq || 'x:*');
    where = `(v.search_vector @@ to_tsquery('simple', $2)
              OR v.full_name ILIKE '%' || $1 || '%'
              OR $1 <% v.full_name
              OR c.name ILIKE '%' || $1 || '%'
              OR v.id_reference = upper($1))`;
    rank = `(ts_rank(v.search_vector, to_tsquery('simple', $2)) * 40
             + CASE WHEN lower(v.full_name) = lower($1) THEN 60 WHEN v.full_name ILIKE $1 || '%' THEN 40 ELSE 0 END
             + word_similarity($1, v.full_name) * 30
             + CASE WHEN c.name ILIKE '%' || $1 || '%' THEN 25 ELSE 0 END)`;
    matchedOn = `CASE WHEN v.search_vector @@ to_tsquery('simple', $2) OR $1 <% v.full_name OR v.full_name ILIKE '%' || $1 || '%' THEN 'name'
                      WHEN c.name ILIKE '%' || $1 || '%' THEN 'company' ELSE 'idReference' END`;
  }

  const limitIdx = params.length + 1;
  const sql = `
    SELECT ${VISITOR_SELECT}, last.*, ${rank} AS rank, ${matchedOn} AS matched_on, count(*) OVER () AS total_count
      FROM visitors v
      LEFT JOIN companies c ON c.id = v.company_id
      LEFT JOIN id_types it ON it.id = v.id_type_id
      ${LAST_VISIT_LATERAL}
     WHERE ${statusFilter} AND ${where}
     ORDER BY rank DESC, v.last_visit_at DESC NULLS LAST, v.id DESC
     LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`;
  const { rows } = await query(sql, [...params, limit, offset]);
  return { items: rows.map(shapeVisitor), total: rows[0]?.total_count ?? 0 };
}

export async function getVisitor(id, runner = { query }) {
  if (!Number.isInteger(Number(id))) throw notFound('Visitor record not found.');
  const { rows } = await runner.query(
    `SELECT ${VISITOR_SELECT}, last.*
       FROM visitors v
       LEFT JOIN companies c ON c.id = v.company_id
       LEFT JOIN id_types it ON it.id = v.id_type_id
       ${LAST_VISIT_LATERAL}
      WHERE v.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Visitor record not found.');
  return shapeVisitor(rows[0]);
}

/** Active visitors sharing a mobile number (duplicate detection). */
export async function findByMobile(countryCode, mobileNumber, runner = { query }) {
  if (!mobileNumber) return [];
  const { rows } = await runner.query(
    `SELECT ${VISITOR_SELECT}, last.*
       FROM visitors v
       LEFT JOIN companies c ON c.id = v.company_id
       LEFT JOIN id_types it ON it.id = v.id_type_id
       ${LAST_VISIT_LATERAL}
      WHERE v.mobile_country_code = $1 AND v.mobile_number = $2 AND v.record_status = 'ACTIVE'
      ORDER BY v.last_visit_at DESC NULLS LAST`,
    [countryCode, mobileNumber],
  );
  return rows.map(shapeVisitor);
}

/** Resolve company input: an existing id, or a new name (reusing an existing match). */
export async function resolveCompany(client, { companyId, newCompanyName }, ctx, canCreate) {
  if (companyId) {
    const { rows } = await client.query('SELECT id, is_active FROM companies WHERE id = $1 AND deleted_at IS NULL', [companyId]);
    if (!rows[0]) throw validationError({ companyId: 'Select a valid organisation / company' });
    return rows[0].id;
  }
  if (!newCompanyName) return null;
  const name = newCompanyName.trim().replace(/\s+/g, ' ');
  const existing = await client.query(
    `SELECT id FROM companies WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = lower($1) AND deleted_at IS NULL`, [name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  if (!canCreate) throw forbidden('You do not have permission to add new organisations. Please select an existing one.');
  const { rows } = await client.query(
    'INSERT INTO companies (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id', [name, ctx.userId],
  );
  await audit(ctx, { action: 'COMPANY_CREATED', entityType: 'company', entityId: rows[0].id, entityRef: name, summary: `Organisation added during registration: ${name}`, newValues: { name } }, client);
  return rows[0].id;
}

async function attachPhoto(client, visitorId, fileId, ctx) {
  const { rows } = await client.query(
    `SELECT id, is_attached, created_by FROM stored_files WHERE id = $1 AND purpose = 'VISITOR_PHOTO' AND deleted_at IS NULL FOR UPDATE`, [fileId],
  );
  const file = rows[0];
  if (!file) throw validationError({ photo: 'The photograph could not be found. Please capture it again.' });
  if (file.is_attached) {
    const owner = await client.query('SELECT 1 FROM visitor_photos WHERE file_id = $1 AND visitor_id = $2', [fileId, visitorId]);
    if (!owner.rows[0]) throw validationError({ photo: 'The photograph could not be used. Please capture it again.' });
    return;
  }
  await client.query('UPDATE stored_files SET is_attached = TRUE WHERE id = $1', [fileId]);
  await client.query('UPDATE visitor_photos SET is_current = FALSE WHERE visitor_id = $1 AND is_current', [visitorId]);
  await client.query('INSERT INTO visitor_photos (visitor_id, file_id, captured_by) VALUES ($1, $2, $3)', [visitorId, fileId, ctx.userId]);
}

async function prepareIdReference(input) {
  if (input.idReference === undefined) return undefined;
  if (!input.idReference) return null;
  const vs = await getSetting('visitor');
  const cleaned = input.idReference.trim().toUpperCase();
  return vs.idNumberStorage === 'FULL' ? cleaned : maskReference(cleaned);
}

const COLUMN_MAP = {
  fullName: 'full_name',
  mobileCountryCode: 'mobile_country_code',
  mobileNumber: 'mobile_number',
  alternateContact: 'alternate_contact',
  email: 'email',
  companyId: 'company_id',
  designation: 'designation',
  address: 'address',
  idTypeId: 'id_type_id',
  idReference: 'id_reference',
};

/**
 * Create a visitor master record. Duplicate detection: if an active visitor
 * already uses this mobile number, creation is refused unless the operator
 * explicitly confirms a different person with a reason (audited).
 */
export async function createVisitor(client, input, ctx, { canCreateCompany = false } = {}) {
  const duplicates = await findByMobile(input.mobileCountryCode, input.mobileNumber, client);
  if (duplicates.length) {
    const sameName = duplicates.find((d) => d.fullName.trim().toLowerCase().replace(/\s+/g, ' ') === input.fullName.toLowerCase());
    if (sameName || !input.duplicateOverrideReason) {
      throw conflict('Existing Visitor Found. A visitor with this mobile number is already registered.', {
        type: 'DUPLICATE_VISITOR', matches: duplicates, canOverride: !sameName,
      });
    }
  }
  const companyId = await resolveCompany(client, input, ctx, canCreateCompany);
  const idReference = await prepareIdReference(input);
  const { rows } = await client.query(
    `INSERT INTO visitors (full_name, mobile_country_code, mobile_number, alternate_contact, email, company_id, designation,
                           address, id_type_id, id_reference, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id, visitor_code`,
    [input.fullName, input.mobileCountryCode, input.mobileNumber, input.alternateContact ?? null, input.email ?? null, companyId,
      input.designation ?? null, input.address ?? null, input.idTypeId ?? null, idReference ?? null, ctx.userId],
  );
  const visitor = rows[0];
  if (input.photoFileId) {
    await attachPhoto(client, visitor.id, input.photoFileId, ctx);
    await client.query('UPDATE visitors SET photo_file_id = $2 WHERE id = $1', [visitor.id, input.photoFileId]);
  }
  await audit(ctx, {
    action: 'VISITOR_CREATED', entityType: 'visitor', entityId: visitor.id, entityRef: visitor.visitor_code,
    summary: `Visitor registered: ${input.fullName}${duplicates.length ? ` (shares mobile with ${duplicates.map((d) => d.visitorCode).join(', ')}; reason: ${input.duplicateOverrideReason})` : ''}`,
    newValues: { fullName: input.fullName, mobile: `${input.mobileCountryCode} ${maskMobile(input.mobileNumber)}`, companyId, email: input.email ?? null },
  }, client);
  return visitor;
}

/** Update only the provided visitor master fields; records a field-level diff in the audit log. */
export async function updateVisitor(client, visitorId, input, ctx, { canCreateCompany = false } = {}) {
  const { rows } = await client.query('SELECT * FROM visitors WHERE id = $1 FOR UPDATE', [visitorId]);
  const current = rows[0];
  if (!current) throw notFound('Visitor record not found.');
  if (current.record_status === 'ANONYMISED') throw conflict('This visitor record has been anonymised and cannot be modified.');

  const next = {};
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (input[key] !== undefined) next[column] = input[key];
  }
  if (input.companyId !== undefined || input.newCompanyName) {
    next.company_id = await resolveCompany(client, input, ctx, canCreateCompany);
  }
  if (input.idReference !== undefined) {
    // An unchanged masked value echoed back by the form must not be re-masked.
    next.id_reference = input.idReference === current.id_reference ? current.id_reference : await prepareIdReference(input);
  }
  if (next.mobile_number && (next.mobile_number !== current.mobile_number || (next.mobile_country_code || current.mobile_country_code) !== current.mobile_country_code)) {
    const others = (await findByMobile(next.mobile_country_code || current.mobile_country_code, next.mobile_number, client)).filter((d) => d.id !== current.id);
    if (others.length && !input.duplicateOverrideReason) {
      throw conflict('Another visitor is already registered with this mobile number.', { type: 'DUPLICATE_VISITOR', matches: others, canOverride: true });
    }
  }
  const before = Object.fromEntries(Object.keys(next).map((k) => [k, current[k]]));
  const { oldValues, newValues, changed } = diff(before, next);
  if (changed) {
    const cols = Object.keys(newValues);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await client.query(`UPDATE visitors SET ${sets}, updated_by = $${cols.length + 2} WHERE id = $1`, [visitorId, ...cols.map((c) => newValues[c]), ctx.userId]);
  }
  let photoChanged = false;
  if (input.photoFileId !== undefined && input.photoFileId !== current.photo_file_id) {
    if (input.photoFileId) {
      await attachPhoto(client, visitorId, input.photoFileId, ctx);
    } else {
      await client.query('UPDATE visitor_photos SET is_current = FALSE WHERE visitor_id = $1 AND is_current', [visitorId]);
    }
    await client.query('UPDATE visitors SET photo_file_id = $2, updated_by = $3 WHERE id = $1', [visitorId, input.photoFileId || null, ctx.userId]);
    photoChanged = true;
  }
  if (changed || photoChanged) {
    if (oldValues.id_reference) oldValues.id_reference = maskReference(oldValues.id_reference);
    if (newValues.id_reference) newValues.id_reference = maskReference(newValues.id_reference);
    await audit(ctx, {
      action: 'VISITOR_UPDATED', entityType: 'visitor', entityId: visitorId, entityRef: current.visitor_code,
      summary: `Visitor information updated: ${[...Object.keys(newValues), ...(photoChanged ? ['photo'] : [])].join(', ')}`,
      oldValues: { ...oldValues, ...(photoChanged ? { photo: current.photo_file_id ? 'present' : 'none' } : {}) },
      newValues: { ...newValues, ...(photoChanged ? { photo: input.photoFileId ? 'updated' : 'removed' } : {}) },
    }, client);
  }
  return { id: visitorId, visitor_code: current.visitor_code, changed: changed || photoChanged };
}

/** Recalculate denormalised visit statistics for a visitor (inside the same transaction). */
export async function refreshVisitorStats(client, visitorId) {
  await client.query(
    `UPDATE visitors v SET
        total_visits   = s.total,
        first_visit_at = s.first_at,
        last_visit_at  = s.last_at
       FROM (SELECT count(*) FILTER (WHERE check_in_at IS NOT NULL) AS total,
                    min(check_in_at) AS first_at, max(check_in_at) AS last_at
               FROM visits WHERE visitor_id = $1) s
      WHERE v.id = $1`,
    [visitorId],
  );
}

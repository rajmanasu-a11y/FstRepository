import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { parse, optText, optId, reqText, email, bool, pageParams, personName } from '../lib/validation.js';
import { checkPasswordPolicy, hashPassword } from '../lib/passwords.js';
import { requireAuth, requirePermission, can } from '../middleware/auth.js';
import { audit, auditContext, diff } from '../services/audit.js';
import { getAllSettings, getSetting, updateSetting } from '../services/settings.js';
import { revokeUserSessions } from '../services/sessions.js';
import { markFileDeleted, removeFromDisk, getFile, readFileBuffer, storeLogo, purgeUnattachedUploads } from '../services/files.js';

// =============================================================================
// Users & roles
// =============================================================================
export const usersRouter = Router();

const userSchema = z.object({
  username: reqText('Username', 40, 3).regex(/^[a-zA-Z0-9._-]+$/, 'Username may contain letters, digits, dot, dash and underscore only').transform((v) => v.toLowerCase()),
  fullName: personName('Full Name'),
  email,
  roleCode: z.enum(['SUPER_ADMIN', 'ADMIN', 'RECEPTION', 'SECURITY', 'HOST'], { error: 'Select a role' }),
  employeeId: optId,
  isActive: bool,
  mustChangePassword: bool,
  password: z.string().max(200).optional(),
});

const shapeUser = (r) => ({
  id: r.id, username: r.username, fullName: r.full_name, email: r.email, roleCode: r.role_code, roleName: r.role_name,
  employeeId: r.employee_id, employeeName: r.employee_name, isActive: r.is_active, mustChangePassword: r.must_change_password,
  locked: r.locked, lastLoginAt: r.last_login_at, createdAt: r.created_at,
});

const USER_SELECT = `u.id, u.username::text, u.full_name, u.email::text, r.code AS role_code, r.name AS role_name, u.employee_id,
  e.full_name AS employee_name, u.is_active, u.must_change_password, (u.locked_until > now()) AS locked, u.last_login_at, u.created_at
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN employees e ON e.id = u.employee_id`;

usersRouter.get('/roles', requirePermission('user.manage'), async (_req, res) => {
  const { rows } = await query(
    `SELECT r.code, r.name, r.description, array_agg(p.code ORDER BY p.code) AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id ORDER BY r.id`,
  );
  res.json({ items: rows });
});

usersRouter.get('/', requirePermission('user.manage'), async (req, res) => {
  const { rows } = await query(`SELECT ${USER_SELECT} WHERE u.deleted_at IS NULL ORDER BY r.id, u.full_name`);
  res.json({ items: rows.map(shapeUser) });
});

async function roleId(client, code) {
  const { rows } = await client.query('SELECT id FROM roles WHERE code = $1', [code]);
  return rows[0].id;
}

usersRouter.post('/', requirePermission('user.manage'), async (req, res) => {
  const b = parse(userSchema, req.body);
  if (!b.password) throw validationError({ password: 'An initial password is required' });
  const policyError = checkPasswordPolicy(b.password, await getSetting('security'));
  if (policyError) throw validationError({ password: policyError });
  if (b.roleCode === 'HOST' && !b.employeeId) throw validationError({ employeeId: 'Link the host user to an employee record' });
  const ctx = auditContext(req);
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (username, full_name, email, password_hash, role_id, employee_id, is_active, must_change_password, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
      [b.username, b.fullName, b.email ?? null, await hashPassword(b.password), await roleId(client, b.roleCode), b.employeeId ?? null,
        b.isActive ?? true, b.mustChangePassword ?? true, ctx.userId],
    );
    await audit(ctx, { action: 'USER_CREATED', entityType: 'user', entityId: rows[0].id, entityRef: b.username, summary: `User account created: ${b.username} (${b.roleCode})`, newValues: { ...b, password: undefined } }, client);
    return rows[0].id;
  });
  const { rows } = await query(`SELECT ${USER_SELECT} WHERE u.id = $1`, [id]);
  res.status(201).json({ user: shapeUser(rows[0]), message: 'The user account has been created successfully.' });
});

usersRouter.put('/:id', requirePermission('user.manage'), async (req, res) => {
  const id = Number(req.params.id) || 0;
  const b = parse(userSchema.omit({ password: true, username: true }), req.body);
  if (id === req.user.id && (b.roleCode !== req.user.roleCode || b.isActive === false)) {
    throw conflict('You cannot change your own role or deactivate your own account.');
  }
  if (b.roleCode === 'HOST' && !b.employeeId) throw validationError({ employeeId: 'Link the host user to an employee record' });
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL FOR UPDATE OF u`, [id]);
    if (!rows[0]) throw notFound('User account not found.');
    const next = { full_name: b.fullName, email: b.email ?? null, role_code: b.roleCode, employee_id: b.employeeId ?? null, is_active: b.isActive ?? rows[0].is_active, must_change_password: b.mustChangePassword ?? rows[0].must_change_password };
    const { oldValues, newValues, changed } = diff(rows[0], next);
    if (!changed) return;
    await client.query(
      `UPDATE users SET full_name = $2, email = $3, role_id = $4, employee_id = $5, is_active = $6, must_change_password = $7, updated_by = $8 WHERE id = $1`,
      [id, next.full_name, next.email, await roleId(client, b.roleCode), next.employee_id, next.is_active, next.must_change_password, ctx.userId],
    );
    await audit(ctx, { action: 'USER_UPDATED', entityType: 'user', entityId: id, entityRef: rows[0].username, summary: `User account updated: ${rows[0].username}`, oldValues, newValues }, client);
    if (newValues.role_code || newValues.is_active === false) await revokeUserSessions(id);
  });
  const { rows } = await query(`SELECT ${USER_SELECT} WHERE u.id = $1`, [id]);
  res.json({ user: shapeUser(rows[0]), message: 'The user account has been updated successfully.' });
});

usersRouter.post('/:id/reset-password', requirePermission('user.manage'), async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { password } = parse(z.object({ password: z.string().min(1, 'Password is required').max(200) }), req.body);
  const policyError = checkPasswordPolicy(password, await getSetting('security'));
  if (policyError) throw validationError({ password: policyError });
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('User account not found.');
    await client.query(`UPDATE users SET password_hash = $2, must_change_password = TRUE, failed_login_count = 0, locked_until = NULL,
                        password_changed_at = now(), updated_by = $3 WHERE id = $1`, [id, await hashPassword(password), ctx.userId]);
    await audit(ctx, { action: 'USER_PASSWORD_RESET', entityType: 'user', entityId: id, entityRef: rows[0].username, summary: `Password reset for ${rows[0].username}` }, client);
  });
  await revokeUserSessions(id);
  res.json({ message: 'The password has been reset. The user must change it at next sign-in.' });
});

usersRouter.post('/:id/unlock', requirePermission('user.manage'), async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { rows } = await query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1 RETURNING username', [id]);
  if (!rows[0]) throw notFound('User account not found.');
  await audit(auditContext(req), { action: 'USER_UNLOCKED', entityType: 'user', entityId: id, entityRef: rows[0].username, summary: `Account unlocked: ${rows[0].username}` });
  res.json({ message: 'The account has been unlocked.' });
});

// =============================================================================
// Settings & print templates
// =============================================================================
export const settingsRouter = Router();

const SETTINGS_SCHEMAS = {
  organisation: z.object({
    name: reqText('Organisation Name', 150, 2),
    shortName: optText(30),
    address: optText(300),
    phone: optText(40),
    email,
    website: optText(200),
    footerText: optText(300),
    receptionPoint: reqText('Reception Point', 80),
    timezone: z.string().refine((tz) => { try { Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Select a valid time zone'),
    defaultCountryCode: z.string().regex(/^\+\d{1,4}$/, 'Enter a valid country code'),
  }),
  visitor: z.object({
    defaultDurationMinutes: z.coerce.number().int().min(5).max(1440),
    maxDurationMinutes: z.coerce.number().int().min(15).max(1440),
    overstayGraceMinutes: z.coerce.number().int().min(0).max(240),
    requireApprovalForWalkIns: z.boolean(),
    idNumberStorage: z.enum(['MASKED', 'FULL']),
    requiredFields: z.object({
      email: z.boolean(), company: z.boolean(), designation: z.boolean(), idType: z.boolean(), idNumber: z.boolean(),
      photo: z.boolean(), category: z.boolean(), accessArea: z.boolean(), declaration: z.boolean(),
    }),
    declarationText: reqText('Declaration Text', 1000, 10),
    declarationVersion: reqText('Declaration Version', 10),
  }).refine((v) => v.defaultDurationMinutes <= v.maxDurationMinutes, { message: 'Default duration cannot exceed the maximum duration', path: ['defaultDurationMinutes'] }),
  notification: z.object({
    inApp: z.boolean(),
    email: z.object({ enabled: z.boolean(), fromAddress: z.string().max(200).optional().default('') }),
    sms: z.object({ enabled: z.boolean(), provider: z.string().max(60).optional().default('') }),
    whatsapp: z.object({ enabled: z.boolean(), provider: z.string().max(60).optional().default('') }),
    overstay: z.object({ reception: z.boolean(), security: z.boolean(), host: z.boolean(), admin: z.boolean() }),
    restrictedAlert: z.object({ security: z.boolean(), admin: z.boolean() }),
  }),
  security: z.object({
    sessionTimeoutMinutes: z.coerce.number().int().min(5).max(480),
    absoluteSessionHours: z.coerce.number().int().min(1).max(24),
    passwordMinLength: z.coerce.number().int().min(8).max(64),
    passwordRequireComplexity: z.boolean(),
    maxLoginAttempts: z.coerce.number().int().min(3).max(20),
    lockoutMinutes: z.coerce.number().int().min(1).max(1440),
    showContactOnEmergencyList: z.boolean(),
    maskMobileInPrint: z.boolean(),
  }),
  retention: z.object({
    archiveVisitorsAfterDays: z.coerce.number().int().min(30).max(3650),
    anonymiseVisitorsAfterDays: z.coerce.number().int().min(90).max(7300),
    deletePhotosAfterDays: z.coerce.number().int().min(30).max(3650),
    deleteUnattachedUploadsAfterHours: z.coerce.number().int().min(1).max(720),
  }).refine((v) => v.anonymiseVisitorsAfterDays > v.archiveVisitorsAfterDays, { message: 'Anonymisation must occur after archiving', path: ['anonymiseVisitorsAfterDays'] }),
};

const TEMPLATE_SCHEMAS = {
  VISITOR_PASS: z.object({
    widthMm: z.coerce.number().min(50).max(150),
    heightMm: z.coerce.number().min(40).max(150),
    paper: z.enum(['BADGE', 'A4']),
    showPhoto: z.boolean(),
    showQr: z.boolean(),
    headerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Enter a colour such as #12305a'),
    instruction: reqText('Security Instruction', 300, 5),
  }),
  HALF_A4_RECORD: z.object({
    copies: z.array(z.string().trim().min(1).max(40)).length(2),
    showPhoto: z.boolean(),
    showQr: z.boolean(),
    showSignatures: z.boolean(),
    title: reqText('Title', 60),
  }),
};

settingsRouter.get('/', requirePermission('settings.manage', 'retention.manage'), async (_req, res) => {
  const settings = await getAllSettings();
  const { rows } = await query('SELECT code, name, config, updated_at FROM print_templates ORDER BY id');
  res.json({ settings, printTemplates: rows, smtpConfigured: Boolean(config.smtp.host) });
});

settingsRouter.put('/print-templates/:code', requirePermission('settings.manage'), async (req, res) => {
  const schema = TEMPLATE_SCHEMAS[req.params.code];
  if (!schema) throw notFound();
  const value = parse(schema, req.body);
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT config FROM print_templates WHERE code = $1 FOR UPDATE', [req.params.code]);
    await client.query('UPDATE print_templates SET config = $2, updated_by = $3, updated_at = now() WHERE code = $1', [req.params.code, JSON.stringify(value), ctx.userId]);
    const d = diff(rows[0]?.config, value);
    await audit(ctx, { action: 'SETTINGS_CHANGED', entityType: 'print_template', entityRef: req.params.code, summary: `Print template updated: ${req.params.code}`, oldValues: d.oldValues, newValues: d.newValues }, client);
  });
  res.json({ message: 'Print settings have been saved successfully.' });
});

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

settingsRouter.post('/logo', requirePermission('settings.manage'), logoUpload.single('logo'), async (req, res) => {
  if (!req.file) throw validationError({ logo: 'Please choose a logo image' });
  const stored = await storeLogo(req.file.buffer, { originalName: req.file.originalname, userId: req.user.id });
  const ctx = auditContext(req);
  const removed = await withTransaction(async (client) => {
    const org = (await client.query(`SELECT value FROM system_settings WHERE key = 'organisation' FOR UPDATE`)).rows[0].value;
    await updateSetting(client, 'organisation', { ...org, logoFileId: stored.id }, ctx.userId);
    await client.query('UPDATE stored_files SET is_attached = TRUE WHERE id = $1', [stored.id]);
    await audit(ctx, { action: 'SETTINGS_CHANGED', entityType: 'settings', entityRef: 'organisation.logo', summary: 'Organisation logo updated' }, client);
    return org.logoFileId ? markFileDeleted(client, org.logoFileId) : null;
  });
  await removeFromDisk(removed);
  res.json({ message: 'The organisation logo has been updated.', logoUrl: `/api/files/logo?v=${stored.id}` });
});

settingsRouter.delete('/logo', requirePermission('settings.manage'), async (req, res) => {
  const ctx = auditContext(req);
  const removed = await withTransaction(async (client) => {
    const org = (await client.query(`SELECT value FROM system_settings WHERE key = 'organisation' FOR UPDATE`)).rows[0].value;
    await updateSetting(client, 'organisation', { ...org, logoFileId: null }, ctx.userId);
    await audit(ctx, { action: 'SETTINGS_CHANGED', entityType: 'settings', entityRef: 'organisation.logo', summary: 'Organisation logo removed' }, client);
    return org.logoFileId ? markFileDeleted(client, org.logoFileId) : null;
  });
  await removeFromDisk(removed);
  res.json({ message: 'The organisation logo has been removed.' });
});

settingsRouter.put('/:key', async (req, res) => {
  const key = req.params.key;
  const schema = SETTINGS_SCHEMAS[key];
  if (!schema) throw notFound();
  if (key === 'retention' ? !can(req, 'retention.manage') : !can(req, 'settings.manage')) throw forbidden();
  const value = parse(schema, req.body);
  const ctx = auditContext(req);
  await withTransaction(async (client) => {
    const current = (await client.query('SELECT value FROM system_settings WHERE key = $1 FOR UPDATE', [key])).rows[0]?.value || {};
    // Preserve keys managed elsewhere (e.g. logoFileId).
    const merged = { ...current, ...value };
    await updateSetting(client, key, merged, ctx.userId);
    const d = diff(current, merged);
    await audit(ctx, { action: 'SETTINGS_CHANGED', entityType: 'settings', entityRef: key, summary: `Settings changed: ${key} (${Object.keys(d.newValues).join(', ') || 'no changes'})`, oldValues: d.oldValues, newValues: d.newValues }, client);
  });
  res.json({ settings: await getSetting(key), message: 'Settings have been saved successfully.' });
});

// =============================================================================
// Audit logs
// =============================================================================
export const auditRouter = Router();

auditRouter.get('/', requirePermission('audit.view'), async (req, res) => {
  const f = parse(pageParams.extend({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
    action: z.string().max(60).optional(),
    user: z.string().max(60).optional(),
    entityType: z.string().max(40).optional(),
    entityId: z.string().max(40).optional(),
    q: z.string().max(100).optional(),
  }), req.query);
  const tz = (await getSetting('organisation')).timezone || 'UTC';
  const params = [];
  const where = [];
  const add = (v) => { params.push(v); return `$${params.length}`; };
  if (f.from) where.push(`a.occurred_at >= (${add(f.from)}::date::timestamp AT TIME ZONE ${add(tz)})`);
  if (f.to) where.push(`a.occurred_at < ((${add(f.to)}::date + 1)::timestamp AT TIME ZONE ${add(tz)})`);
  if (f.action) where.push(`a.action = ${add(f.action)}`);
  if (f.user) where.push(`a.username ILIKE '%' || ${add(f.user)} || '%'`);
  if (f.entityType) where.push(`a.entity_type = ${add(f.entityType)}`);
  if (f.entityId) where.push(`a.entity_id = ${add(f.entityId)}`);
  if (f.q) where.push(`(a.summary ILIKE '%' || ${add(f.q)} || '%' OR a.entity_ref ILIKE '%' || $${params.length} || '%')`);
  const { rows } = await query(
    `SELECT a.id, a.occurred_at, a.username, a.role_code, a.action, a.entity_type, a.entity_id, a.entity_ref, a.summary,
            a.old_values, a.new_values, host(a.ip_address) AS ip, a.user_agent, count(*) OVER () AS total_count
       FROM audit_logs a WHERE ${where.length ? where.join(' AND ') : 'TRUE'}
      ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${add(f.pageSize)} OFFSET ${add((f.page - 1) * f.pageSize)}`,
    params,
  );
  const { rows: actions } = await query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  res.json({
    items: rows.map((r) => ({
      id: r.id, occurredAt: r.occurred_at, username: r.username, role: r.role_code, action: r.action, entityType: r.entity_type,
      entityId: r.entity_id, entityRef: r.entity_ref, summary: r.summary, oldValues: r.old_values, newValues: r.new_values, ip: r.ip, userAgent: r.user_agent,
    })),
    total: rows[0]?.total_count ?? 0, page: f.page, pageSize: f.pageSize, actions: actions.map((a) => a.action),
  });
});

// =============================================================================
// Notifications (in-app inbox)
// =============================================================================
export const notificationsRouter = Router();

notificationsRouter.get('/', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT n.id, n.type, n.title, n.body, n.created_at, n.read_at, n.visit_id, vi.visit_code
       FROM notifications n LEFT JOIN visits vi ON vi.id = n.visit_id
      WHERE n.recipient_user_id = $1 AND n.channel = 'IN_APP' ORDER BY n.created_at DESC LIMIT 50`, [req.user.id],
  );
  const { rows: c } = await query(`SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1 AND channel = 'IN_APP' AND read_at IS NULL`, [req.user.id]);
  res.json({
    items: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, createdAt: r.created_at, readAt: r.read_at, visitId: r.visit_id, visitCode: r.visit_code })),
    unread: c[0].n,
  });
});

notificationsRouter.get('/unread-count', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1 AND channel = 'IN_APP' AND read_at IS NULL`, [req.user.id]);
  res.json({ unread: rows[0].n });
});

notificationsRouter.post('/read-all', requireAuth, async (req, res) => {
  await query(`UPDATE notifications SET read_at = now(), status = 'READ' WHERE recipient_user_id = $1 AND channel = 'IN_APP' AND read_at IS NULL`, [req.user.id]);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', requireAuth, async (req, res) => {
  await query(`UPDATE notifications SET read_at = now(), status = 'READ' WHERE id = $1 AND recipient_user_id = $2 AND read_at IS NULL`, [Number(req.params.id) || 0, req.user.id]);
  res.json({ ok: true });
});

// =============================================================================
// Files (photos are served only to authorised users; never from a public folder)
// =============================================================================
export const filesRouter = Router();

filesRouter.get('/logo', async (_req, res) => {
  const org = await getSetting('organisation');
  if (!org.logoFileId) throw notFound();
  const file = await getFile(org.logoFileId);
  res.set('Cache-Control', 'public, max-age=86400').type(file.mime_type).send(await readFileBuffer(file));
});

filesRouter.get('/photos/:id', requireAuth, async (req, res) => {
  const file = await getFile(req.params.id);
  if (file.purpose !== 'VISITOR_PHOTO') throw notFound();
  const allowed = ['visitor.view', 'pass.print', 'onpremises.view', 'visit.view_all'].some((p) => can(req, p));
  if (!allowed) {
    // Hosts may see photos of visitors who are coming to meet them.
    const { rows } = await query(
      `SELECT 1 FROM visitors v JOIN visits vi ON vi.visitor_id = v.id
        WHERE (v.photo_file_id = $1 OR v.id IN (SELECT visitor_id FROM visitor_photos WHERE file_id = $1)) AND vi.host_employee_id = $2 LIMIT 1`,
      [file.id, req.user.employeeId ?? -1],
    );
    // Freshly uploaded (unattached) photos are visible to the uploader.
    if (!rows[0] && !(file.created_by === req.user.id && !file.is_attached)) throw notFound();
  }
  res.set('Cache-Control', 'private, max-age=3600').type(file.mime_type).send(await readFileBuffer(file));
});

// =============================================================================
// Data retention
// =============================================================================
export const retentionRouter = Router();

const RETENTION_QUERIES = {
  archive: `SELECT count(*)::int AS n FROM visitors v WHERE v.record_status = 'ACTIVE'
              AND coalesce(v.last_visit_at, v.created_at) < now() - make_interval(days => $1)
              AND NOT EXISTS (SELECT 1 FROM visits vi WHERE vi.visitor_id = v.id AND vi.status IN ('EXPECTED','PENDING_APPROVAL','APPROVED','CHECKED_IN','OVERSTAY'))`,
  anonymise: `SELECT count(*)::int AS n FROM visitors v WHERE v.record_status IN ('ACTIVE','ARCHIVED') AND v.watchlist_status = 'NONE'
              AND coalesce(v.last_visit_at, v.created_at) < now() - make_interval(days => $1)
              AND NOT EXISTS (SELECT 1 FROM visits vi WHERE vi.visitor_id = v.id AND vi.status IN ('EXPECTED','PENDING_APPROVAL','APPROVED','CHECKED_IN','OVERSTAY'))`,
  photos: `SELECT count(*)::int AS n FROM visitors v WHERE v.photo_file_id IS NOT NULL AND coalesce(v.last_visit_at, v.created_at) < now() - make_interval(days => $1)`,
};

retentionRouter.get('/preview', requirePermission('retention.manage'), async (_req, res) => {
  const r = await getSetting('retention');
  const [a, b, c] = await Promise.all([
    query(RETENTION_QUERIES.archive, [r.archiveVisitorsAfterDays]),
    query(RETENTION_QUERIES.anonymise, [r.anonymiseVisitorsAfterDays]),
    query(RETENTION_QUERIES.photos, [r.deletePhotosAfterDays]),
  ]);
  res.json({ policy: r, toArchive: a.rows[0].n, toAnonymise: b.rows[0].n, photosToDelete: c.rows[0].n });
});

/**
 * Apply the retention policy. Visit transactions are never deleted (they are
 * official records); visitor masters are archived, then anonymised – personal
 * data is removed while statistics remain intact. Restricted visitors are kept.
 */
retentionRouter.post('/run', requirePermission('retention.manage'), async (req, res) => {
  const { confirm } = parse(z.object({ confirm: z.literal(true, { error: 'Confirmation is required' }) }), req.body);
  void confirm;
  const r = await getSetting('retention');
  const ctx = auditContext(req);
  const result = await withTransaction(async (client) => {
    const photos = await client.query(
      `SELECT v.id, v.photo_file_id FROM visitors v WHERE v.photo_file_id IS NOT NULL AND coalesce(v.last_visit_at, v.created_at) < now() - make_interval(days => $1)`,
      [r.deletePhotosAfterDays],
    );
    const removedKeys = [];
    for (const p of photos.rows) {
      await client.query('UPDATE visitors SET photo_file_id = NULL WHERE id = $1', [p.id]);
      await client.query('UPDATE visitor_photos SET is_current = FALSE WHERE visitor_id = $1', [p.id]);
      removedKeys.push(await markFileDeleted(client, p.photo_file_id));
    }
    const anon = await client.query(
      `UPDATE visitors v SET full_name = 'Anonymised Visitor', mobile_number = NULL, alternate_contact = NULL, email = NULL, address = NULL,
              id_reference = NULL, designation = NULL, photo_file_id = NULL, record_status = 'ANONYMISED', anonymised_at = now(), updated_by = $2
        WHERE v.record_status IN ('ACTIVE','ARCHIVED') AND v.watchlist_status = 'NONE'
          AND coalesce(v.last_visit_at, v.created_at) < now() - make_interval(days => $1)
          AND NOT EXISTS (SELECT 1 FROM visits vi WHERE vi.visitor_id = v.id AND vi.status IN ('EXPECTED','PENDING_APPROVAL','APPROVED','CHECKED_IN','OVERSTAY'))
        RETURNING v.id`, [r.anonymiseVisitorsAfterDays, ctx.userId],
    );
    const arch = await client.query(
      `UPDATE visitors v SET record_status = 'ARCHIVED', archived_at = now(), updated_by = $2
        WHERE v.record_status = 'ACTIVE' AND coalesce(v.last_visit_at, v.created_at) < now() - make_interval(days => $1)
          AND NOT EXISTS (SELECT 1 FROM visits vi WHERE vi.visitor_id = v.id AND vi.status IN ('EXPECTED','PENDING_APPROVAL','APPROVED','CHECKED_IN','OVERSTAY'))
        RETURNING v.id`, [r.archiveVisitorsAfterDays, ctx.userId],
    );
    // Photographs of anonymised visitors are removed as well.
    const anonPhotos = await client.query(
      `SELECT vp.file_id FROM visitor_photos vp WHERE vp.visitor_id = ANY($1::bigint[])`, [anon.rows.map((x) => x.id)],
    );
    for (const f of anonPhotos.rows) removedKeys.push(await markFileDeleted(client, f.file_id));
    const summary = { photosDeleted: photos.rows.length, anonymised: anon.rows.length, archived: arch.rows.length, removedKeys };
    await audit(ctx, { action: 'RETENTION_APPLIED', entityType: 'retention', summary: `Retention applied: ${summary.archived} archived, ${summary.anonymised} anonymised, ${summary.photosDeleted} photographs deleted`, newValues: { archived: summary.archived, anonymised: summary.anonymised, photosDeleted: summary.photosDeleted } }, client);
    return summary;
  });
  await removeFromDisk(result.removedKeys);
  delete result.removedKeys;
  result.uploadsPurged = await purgeUnattachedUploads(r.deleteUnattachedUploadsAfterHours);
  res.json({ ...result, message: 'The data retention policy has been applied.' });
});

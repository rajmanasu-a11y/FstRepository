import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { getSetting } from './settings.js';

/**
 * Notification architecture
 * -------------------------
 * Every notification is persisted first (inside the business transaction),
 * one row per channel. IN_APP rows are delivered by being stored. External
 * channels (EMAIL / SMS / WHATSAPP) are dispatched after commit by
 * dispatchPending(), using a pluggable adapter per channel. A channel that is
 * disabled or has no configured provider is recorded as SKIPPED with the
 * reason, so the record is honest about what was actually sent.
 */

const adapters = {
  EMAIL: {
    isConfigured: () => Boolean(config.smtp.host),
    async send(n, settings) {
      transporter ??= nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
      await transporter.sendMail({
        from: settings.email?.fromAddress || config.smtp.user,
        to: n.recipient_address,
        subject: n.title,
        text: n.body,
      });
    },
  },
  // Integration points for SMS / WhatsApp gateways. Register a provider by
  // implementing { isConfigured(), send(notification, settings) }.
  SMS: { isConfigured: () => false, async send() { throw new Error('No SMS provider configured'); } },
  WHATSAPP: { isConfigured: () => false, async send() { throw new Error('No WhatsApp provider configured'); } },
};
let transporter;

export function registerChannelAdapter(channel, adapter) {
  adapters[channel] = adapter;
}

async function insertNotification(client, n) {
  await client.query(
    `INSERT INTO notifications (channel, type, recipient_user_id, recipient_employee_id, recipient_address, title, body, payload,
                                visit_id, status, status_detail, sent_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $10 = 'DELIVERED' THEN now() END, now())`,
    [n.channel, n.type, n.recipientUserId ?? null, n.recipientEmployeeId ?? null, n.recipientAddress ?? null, n.title, n.body,
      JSON.stringify(n.payload ?? {}), n.visitId ?? null, n.status, n.statusDetail ?? null],
  );
}

/** Notify a host employee on every configured channel. */
export async function notifyHost(client, { hostEmployeeId, type, title, body, payload, visitId }) {
  const settings = await getSetting('notification');
  const { rows: hostRows } = await client.query(
    'SELECT id, official_email::text AS email, official_mobile FROM employees WHERE id = $1', [hostEmployeeId],
  );
  const host = hostRows[0];
  if (!host) return;
  if (settings.inApp !== false) {
    const { rows: users } = await client.query(
      'SELECT id FROM users WHERE employee_id = $1 AND is_active AND deleted_at IS NULL', [hostEmployeeId],
    );
    for (const u of users) {
      await insertNotification(client, { channel: 'IN_APP', type, recipientUserId: u.id, recipientEmployeeId: host.id, title, body, payload, visitId, status: 'DELIVERED' });
    }
  }
  const external = [
    ['EMAIL', settings.email?.enabled, host.email],
    ['SMS', settings.sms?.enabled, host.official_mobile],
    ['WHATSAPP', settings.whatsapp?.enabled, host.official_mobile],
  ];
  for (const [channel, enabled, address] of external) {
    if (!enabled) continue;
    const base = { channel, type, recipientEmployeeId: host.id, recipientAddress: address, title, body, payload, visitId };
    if (!address) {
      await insertNotification(client, { ...base, status: 'SKIPPED', statusDetail: 'Host has no contact address for this channel' });
    } else {
      await insertNotification(client, { ...base, status: 'PENDING' });
    }
  }
}

/** In-app notification to every active user holding one of the given roles. */
export async function notifyRoles(client, roleCodes, { type, title, body, payload, visitId }) {
  if (!roleCodes.length) return;
  const { rows } = await client.query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = ANY($1) AND u.is_active AND u.deleted_at IS NULL`, [roleCodes],
  );
  for (const u of rows) {
    await insertNotification(client, { channel: 'IN_APP', type, recipientUserId: u.id, title, body, payload, visitId, status: 'DELIVERED' });
  }
}

/** Deliver queued external notifications. Safe to call repeatedly. */
export async function dispatchPending() {
  const settings = await getSetting('notification');
  const { rows } = await query(
    `UPDATE notifications SET attempts = attempts + 1
      WHERE id IN (SELECT id FROM notifications WHERE status = 'PENDING' AND attempts < 3
                    ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
  );
  for (const n of rows) {
    const adapter = adapters[n.channel];
    if (!adapter || !adapter.isConfigured()) {
      await query(`UPDATE notifications SET status = 'SKIPPED', status_detail = $2 WHERE id = $1`,
        [n.id, `${n.channel} channel enabled but no provider is configured`]);
      continue;
    }
    try {
      await adapter.send(n, settings);
      await query(`UPDATE notifications SET status = 'SENT', sent_at = now(), status_detail = NULL WHERE id = $1`, [n.id]);
    } catch (err) {
      await query(`UPDATE notifications SET status = CASE WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END, status_detail = $2 WHERE id = $1`,
        [n.id, String(err.message).slice(0, 500)]);
    }
  }
  return rows.length;
}

export function arrivalMessage({ visitorName, companyName, purpose, arrival, receptionPoint, passNumber }) {
  return [
    'Visitor Arrival Notification',
    '',
    `Visitor: ${visitorName}`,
    `Organisation: ${companyName || '—'}`,
    `Purpose: ${purpose}`,
    `Arrival: ${arrival}`,
    `Reception: ${receptionPoint || 'Main Entrance'}`,
    ...(passNumber ? [`Visitor Pass Number: ${passNumber}`] : []),
  ].join('\n');
}

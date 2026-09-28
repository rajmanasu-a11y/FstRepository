/**
 * Create (or reset) a Super Administrator account from the server console.
 * Usage: npm run user:create-admin -- <username> "<Full Name>"
 * The temporary password is read from the VMS_ADMIN_PASSWORD environment
 * variable (so it does not appear in shell history or the process list) and
 * must be changed at first sign-in.
 */
import { pool, query } from './pool.js';
import { hashPassword, checkPasswordPolicy } from '../lib/passwords.js';
import { migrate } from './migrate.js';

const [username, fullName = 'System Administrator'] = process.argv.slice(2);
const password = process.env.VMS_ADMIN_PASSWORD;
if (!username || !password) {
  console.error('Usage: VMS_ADMIN_PASSWORD="<temporary password>" npm run user:create-admin -- <username> "<Full Name>"');
  process.exit(2);
}
const problem = checkPasswordPolicy(password, { passwordMinLength: 10, passwordRequireComplexity: true });
if (problem) { console.error(problem); process.exit(2); }

try {
  await migrate({ log: () => {} });
  const hash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (username, full_name, password_hash, role_id, must_change_password)
     SELECT $1, $2, $3, id, TRUE FROM roles WHERE code = 'SUPER_ADMIN'
     ON CONFLICT (username) WHERE deleted_at IS NULL
     DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = TRUE, is_active = TRUE,
                   failed_login_count = 0, locked_until = NULL,
                   role_id = EXCLUDED.role_id
     RETURNING id, (xmax = 0) AS inserted`,
    [username.toLowerCase(), fullName, hash],
  );
  await query(`INSERT INTO audit_logs (username, role_code, action, entity_type, entity_id, entity_ref, summary)
               VALUES ('console', 'SYSTEM', $1, 'user', $2, $3, $4)`,
  [rows[0].inserted ? 'USER_CREATED' : 'USER_PASSWORD_RESET', String(rows[0].id), username, 'Super Administrator account set from the server console']);
  console.log(`${rows[0].inserted ? 'Created' : 'Reset'} Super Administrator "${username}". The password must be changed at first sign-in.`);
} finally {
  await pool.end();
}

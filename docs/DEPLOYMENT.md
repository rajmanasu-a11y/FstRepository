# Deployment

## Requirements

- Linux server with Node.js 20 or later
- PostgreSQL 14 or later (tested with 16) with the `pg_trgm` and `citext` extensions (both ship with PostgreSQL's contrib package)
- A reverse proxy terminating TLS (nginx template in `deploy/nginx.conf`)
- Optional: an SMTP relay for e-mail host notifications

## Steps

```bash
# Database
sudo -u postgres psql -c "CREATE ROLE vms LOGIN PASSWORD '<strong password>'" -c "CREATE DATABASE vms OWNER vms"

# Application
sudo useradd --system --home /opt/vms vms
sudo mkdir -p /opt/vms /var/lib/vms/storage /etc/vms && sudo chown vms: /var/lib/vms/storage
# copy the release to /opt/vms, then:
cd /opt/vms && sudo -u vms npm ci --omit=dev
sudo cp .env.example /etc/vms/vms.env && sudo chmod 600 /etc/vms/vms.env   # edit values
sudo cp deploy/vms.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now vms
```

The service applies pending database migrations at start-up (`AUTO_MIGRATE=true`); run `npm run db:migrate` manually
if you prefer controlled migrations. **Do not run `npm run db:seed` in production.**

## First sign-in

A production database created with `db:migrate` contains reference data (roles, permissions, categories, purposes, access
areas, settings) but no users. Create the first Super Administrator from the server:

```bash
cd /opt/vms && sudo -u vms env $(grep -v '^#' /etc/vms/vms.env | xargs) \
  VMS_ADMIN_PASSWORD='<temporary password>' npm run user:create-admin -- superadmin "System Administrator"
```

The same command resets the password (and unlocks the account) if the administrator is ever locked out.

Sign in, change the temporary password (enforced), then in **Settings**:

1. Organisation — name, address, logo, reception point, **time zone**, footer text.
2. Masters — departments; then add hosts under **Hosts** (or import them into `employees`).
3. Visitor rules — durations, overstay grace, mandatory fields, ID storage (masked recommended), declaration text.
4. Security — session timeout, password policy, lockout.
5. Print settings — badge size and printer type; test-print a pass and a Half-A4 record.
6. Users & Roles — create reception, security, administrator and host accounts (host users are linked to an employee).
7. Data retention — set the policy agreed with your records officer.

## Configuration reference

See `.env.example`. Important production values:

| Variable | Notes |
|---|---|
| `NODE_ENV=production` | enables `Secure` cookies and HSTS |
| `PUBLIC_BASE_URL` | the HTTPS URL users reach; embedded in QR codes |
| `TRUST_PROXY` | `loopback` when nginx runs on the same host |
| `STORAGE_DIR` | outside the application directory; include in backups |
| `SMTP_*` | leave `SMTP_HOST` empty to disable e-mail (notifications are then recorded as skipped) |

## Printing

- **Visitor pass:** a badge/card printer with the page size set to the badge size (default 90 × 60 mm), or choose
  “Office printer (badge on A4)” in Print Settings.
- **Half-A4 visitor record:** any A4 printer; the page contains two identical records with a cut line.
- In the browser print dialog use *Actual size / 100 %* and switch off headers and footers.
  Server-side PDFs (Download PDF) are available when the exact layout must be preserved.

## Operations

- Health check: `GET /api/health` (checks database connectivity).
- Logs: `journalctl -u vms`. Unexpected errors are also stored in the `error_logs` table with the reference number shown to the user.
- Backups: see [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
- Scaling: the application is stateless apart from `STORAGE_DIR` (use shared storage when running several instances);
  the overstay job uses a PostgreSQL advisory lock so only one instance processes it at a time.

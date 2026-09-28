# Visitor Management System (VMS)

A production-oriented Visitor Management System for offices, government establishments, campuses and secure facilities.
Built for fast, keyboard-driven reception work, accurate records, printable passes and records, and complete auditability.

- **Backend:** Node.js 20+ · Express 5 · REST API · server-side validation (zod)
- **Database:** PostgreSQL 14+ (developed and tested on 16) — normalised schema, foreign keys, check/unique constraints, trigram + full-text GIN indexes, append-only audit log
- **Frontend:** dependency-free ES-module single-page application (no build step), responsive, accessible
- **Printing:** CSS print layouts in millimetres (visitor badge, Half-A4 record ×2 per sheet, reports, emergency roll call) plus server-side PDFs
- **Exports:** PDF, Excel (.xlsx) and CSV — always filtered exactly as on screen

---

## Quick start

```bash
# 1. PostgreSQL: create a role and database (pg_trgm and citext are "trusted" extensions,
#    so the database owner can create them during migration).
sudo -u postgres psql -c "CREATE ROLE vms LOGIN PASSWORD 'vms'" -c "CREATE DATABASE vms OWNER vms"

# 2. Application
cp .env.example .env        # set DATABASE_URL; for local HTTP use NODE_ENV=development
npm install
npm run db:migrate          # creates the schema and reference data
npm run db:seed             # optional: realistic demo data (dates relative to today)
npm start                   # http://localhost:3000
```

`npm run db:reset` drops and recreates the schema, then reloads demo data.

### Demo accounts (seed data only — password `Vms@Demo2026`)

| Username | Role | Lands on |
|---|---|---|
| `superadmin` | Super Administrator | everything, incl. settings, users, audit logs, exports, retention |
| `admin` | Administrator | operations, hosts, companies, reports |
| `reception`, `reception2` | Reception / Front Desk Officer | registration, check-in/out, passes |
| `security` | Security Officer | verify pass, on premises, emergency roll call |
| `rajesh.kumar`, `priya.sharma` | Host / Employee | own visitors, pre-registration, approvals |

The demo includes the specification's example: search **9876543210** → *Existing Visitor Found — RAMESH KUMAR, ABC Technologies Pvt. Ltd., 12 visits, last host Mr. Rajesh Kumar (Manager – Administration), Official Meeting*.
Change or remove demo accounts before production use.

---

## Main features

| Area | What is implemented |
|---|---|
| **Returning-visitor search** | Search box at the top of Visitor Registration; server-side, debounced, ranked. Mobile (prefix/suffix/formatted), name (full-text + typo-tolerant trigram), organisation, email, visitor ID, pass number, visit reference, scanned QR. *Existing Visitor Found* card with last visit, total visits, last host + designation, last purpose → **Use Existing Details** fills the form and pre-fills the last host/purpose for confirmation. |
| **Visitor registration** | Sectioned two-column form; organisation autocomplete with **+ Add New Company**; host search showing name + designation + department (department auto-filled); purpose with *Specify Purpose* for “Other”; appointment, category, vehicle, access area, declaration; camera capture or upload (resized, EXIF-stripped). Register, Register + Check-In, print pass / Half-A4 record. |
| **Duplicate detection** | Mobile checked on entry and on save; the existing record is offered. A different person on a shared number can be registered only with a reason (audited). The DB prevents the same person twice. |
| **Workflow** | Expected/pre-registered → arrival → verify → host → purpose → photo/ID → approval → check-in (pass issued, host notified) → on premises → overstay → check-out (duration) → closed. Every stage is time-stamped in the visit timeline. |
| **Check-in / Check-out desks** | Fast search by name, mobile, pass number, visit reference or QR scan (USB scanners work as keyboards; a single match is auto-selected). |
| **Pre-registration & QR** | Hosts (for themselves) and reception (for any host) register expected visitors; a Visit Reference Number and QR invitation are generated. QR codes contain only a random token URL — no personal data. |
| **Approvals** | Categories or access areas can require host approval; hosts approve/reject (reason required) in-app; administrators can override. |
| **Restricted visitors** | Flagged (alert) and Blocked (entry denied, recorded as DENIED) with reasons; Security and administrators alerted. |
| **Overstay** | Background job flags visits past expected duration + grace; notifies configured roles and the host. |
| **Notifications** | Persisted per channel. In-app delivered; e-mail via SMTP when configured; SMS/WhatsApp are adapter integration points — without a provider those notifications are recorded as *skipped*, never silently dropped. |
| **Dashboard** | Eight summary cards, quick actions, live status table with Today/Yesterday/Week/Month/Custom filters, charts (by day, month, department, purpose, organisation, repeat vs first-time, average duration, peak hours). |
| **Reports** | Daily, weekly, monthly, date-wise, host-, department-, company-, purpose-, category-wise, repeat, first-time, currently on premises, checked-out, pending approval, overstay, vehicle entry, restricted, audit. Filters, sorting, pagination, column visibility, search, Excel/PDF/CSV export, print. |
| **Emergency roll call** | One-click printable accountability list grouped into employees (visiting staff), visitors, contractors and service personnel, with “accounted for” tick boxes. |
| **Printing** | Visitor pass (90 × 60 mm or configurable; badge printer or A4 with cut line), Half-A4 visitor record (two identical copies per A4 sheet with cut line and signature fields), invitation, reports, on-premises list, roll call, visitor history — each with a print preview. |
| **Administration** | Organisation settings and logo, visitor rules and mandatory fields, masters (departments, categories, purposes, access areas, ID types), notification, print, security (session timeout, password policy, lockout) settings, users and roles, data retention (archive → anonymise; visit records retained). |
| **Audit** | Append-only audit log (DB trigger blocks UPDATE/DELETE): sign-ins, failures, lockouts, record views, creations, field-level changes (previous / new values), check-in/out, prints, exports, settings changes — with user, role, IP and device. |

### Keyboard operation (Visitor Registration)

- The page opens with the cursor in **Search Existing Visitor**. **F2** returns to it from anywhere.
- **Tab / Shift+Tab** follow the designed order: Search → Search → New Visitor → Clear → Name → (country code) → Mobile → Email → Organisation → Designation → … → Host → Department → Purpose → Date → Arrival → Duration → Category → Vehicle → Access Area → Declaration → Save / Register → Check-In → Print Pass → Clear / Cancel. Hidden and disabled controls are skipped; conditional fields appear in place.
- **Enter** moves to the next field (it does not submit by accident); **Ctrl+Enter** registers.
- Suggestions: **↓/↑** to move, **Enter** to select, **Tab** accepts the highlighted option, **Esc** closes.
- Date and time are single Tab stops: type `28-09-2026`, `today`, `+1`, `10:30 am`, or use **↑/↓**.
- After saving, focus moves to **Check-In**; after check-in, to **Print Pass**.

---

## Project structure

```
server/
  index.js, app.js, config.js, jobs.js       entry point, Express app, configuration, scheduled jobs
  db/migrations/*.sql                        schema and reference data (tracked in schema_migrations)
  db/migrate.js, db/seed.js, db/pool.js      migration runner, demo data, pool + transactions
  middleware/                                sessions/RBAC/CSRF, error handling
  routes/                                    REST endpoints
  services/                                  visitor search, visit lifecycle, reports, exports, notifications, files
  lib/                                       validation, errors, passwords (scrypt), time zone and formatting
public/                                      single-page application (HTML, CSS, ES modules)
tests/api/                                   API, security and database tests (node:test)
tests/e2e/                                   Playwright end-to-end tests
scripts/                                     backup.sh, verify-backup.sh, restore.sh
deploy/                                      systemd and nginx templates
docs/                                        architecture, deployment, backup & recovery, testing
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the data model, security model and API,
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**, **[docs/BACKUP_AND_RECOVERY.md](docs/BACKUP_AND_RECOVERY.md)** and
**[docs/TESTING.md](docs/TESTING.md)**.

## Tests

```bash
npm run test:api     # 83 API / security / database tests against a disposable database
npm run test:e2e     # 43 Playwright tests: workflows, keyboard, print, roles, responsive, UX
npm test             # both
```

Both suites use `TEST_DATABASE_URL` (default `postgres://vms:vms@localhost:5432/vms_test`), which they **drop and recreate** —
never point it at a real database.

## Known limitations

- SMS and WhatsApp delivery require a provider adapter (`registerChannelAdapter` in `server/services/notifications.js`); none is bundled.
- Employee presence is not tracked by the VMS; the roll call covers visitors and visiting staff registered in the VMS.
- Backups are run by the provided scripts from cron/systemd at server level, not from the web interface.
- The browser print preview uses the user's printer settings; select *Actual size / 100 %* and disable browser headers/footers. Server-side PDFs are provided where byte-exact output is needed.

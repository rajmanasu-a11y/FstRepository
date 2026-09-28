# Testing

Two automated suites run against a disposable PostgreSQL database (`TEST_DATABASE_URL`, default
`postgres://vms:vms@localhost:5432/vms_test`), which is **dropped, migrated and re-seeded** for every test file.

```bash
npm run test:api   # node:test — API, security, database (each file in its own process with a fresh database)
npm run test:e2e   # Playwright (Chromium) — boots its own server on port 3100
npm test           # both
```

Latest run in the development environment: **83 / 83 API tests passed, 43 / 43 end-to-end tests passed.**

## Coverage by requirement

### Authentication (`tests/api/auth.test.js`, `ratelimit.test.js`, `e2e/security-and-roles.spec.js`)
Valid and invalid sign-in (indistinguishable messages for unknown users), lockout after repeated failures and unlock, logout
revokes the server session, idle-session expiry, unauthenticated API access refused, CSRF token and Origin checks, password
policy and revocation of other sessions, forced change of temporary passwords, sign-in rate limiting, security headers,
redirect to sign-in and back, sign-out.

### Roles and authorisation (`rbac.test.js`, `e2e/security-and-roles.spec.js`)
Per-role API matrix (reception, administrator, security, host, super administrator), export authorisation, host scoping (own
visits only; other visits return 404), hosts can approve only their own visitors, role-escalation attempts refused,
self-demotion prevented, role changes revoke sessions, navigation per role, direct URL access to restricted screens.

### Visitors (`visitors.test.js`, `e2e/workflows.spec.js`)
Specification example (9876543210 → Ramesh Kumar, 12 visits, last host and purpose); search by mobile prefix/suffix/formatted,
name, typo-tolerant name, organisation, email, visitor ID, pass number and scanned QR URL; pagination; new visitor
registration; duplicate detection and audited override; returning visitor reuse without a new master record; field-level
update auditing; validation of names, mobiles, emails, purpose, dates and organisation; SQL-injection and XSS payloads;
restricted visitors denied with Security alerted; profile statistics and view auditing.

### Visits (`visits.test.js`)
Pre-registration → expected → check-in (declaration enforced, pass issued, host notified with the specified message) →
duplicate check-in refused → check-out with calculated duration → timeline of every stage; check-out before check-in refused
(application and database); future appointments; approval and rejection for restricted areas; ID-verification requirement by
category; cancellation; overstay detection and alerts; concurrent check-in of one visit from three desks (exactly one
succeeds, one pass issued); twelve parallel registrations and check-outs from three desks (unique reference and pass
numbers); one active visit per visitor; on-premises and emergency lists; lookup by id, reference, pass number and QR token.

### Reports and exports (`reports.test.js`, `e2e/ux.spec.js`, `e2e/print.spec.js`)
Every report type; standard daily columns; date-range, department, host and status filters; group totals; whitelisted
sorting; CSV (UTF-8 BOM, row count equals the filtered total), PDF and Excel exports; column selection; formula-injection
neutralisation; export auditing; export refused without permission; emergency PDF; dashboard figures and analytics;
server-side Half-A4 PDF (one A4 page) and badge PDF (90 × 60 mm). In the browser: filter, sort, column visibility, Excel and
PDF downloads, print preview.

### Printing (`e2e/print.spec.js`, `e2e/workflows.spec.js`)
Half-A4 record: sheet 210 × 297 mm, each record 148.5 mm, cut line at mid-page, no overflow or clipped element, correct visitor,
host, designation, department, check-in time, pass and reference numbers, masked mobile, photo loaded and positioned in the
right column, QR code decoded (jsQR) to the correct verification URL, printed PDF exactly one A4 page. Visitor pass: 90 × 60 mm,
no overflow, readable QR, one page at badge size. Reports print in A4 landscape without application chrome; the on-premises
print lists every visitor on premises; the emergency roll call prints with every person.

### Keyboard (`e2e/keyboard.spec.js`)
Initial focus; complete TAB sequence equals the designed order (the specification's recommended order is contained in it);
SHIFT+TAB reverses it exactly; hidden and disabled controls skipped; conditional fields join in place; ENTER advances without
submitting; CTRL+ENTER registers; F2 and ESC; arrow keys, ENTER, TAB and ESC in autocomplete lists; arrow keys in native
dropdowns; single-stop date and time fields; focus trap and ESC in modal dialogs with focus returned; a complete keyboard-only
registration → check-in → print; keyboard-only check-in and check-out desks; search results reachable with the arrow keys.

### Database (`database.test.js`, `uploads.test.js`, `directory.test.js`)
Master/transaction separation; required tables; foreign keys; unique constraints; partial unique indexes for active
check-ins and live passes; check constraints; NOT NULL; append-only audit log; transaction rollback leaves no partial
records; 60 concurrent document numbers are unique; index usage verified with `EXPLAIN`; UTC `timestamptz` storage and
organisation-time-zone dates; soft deletion keeps history. Uploads: resize/compress to 360 × 480 JPEG, EXIF removed, disguised
files, PDFs and SVGs rejected (415), oversized files rejected (413), photo access control and path traversal, photos cannot
be reused across visitors. Directories, masters, settings validation and data retention (anonymisation keeps visit records
and restricted visitors).

### User experience (`e2e/ux.spec.js`, `e2e/responsive.spec.js`, `e2e/security-and-roles.spec.js`)
Loading and empty states, unsaved-changes guard and draft recovery (ID number never stored in drafts), inline validation
associated with fields, dashboard, generic error messages for server and network failures, CSP blocks inline script,
tablet (820 px) and phone (412 px) layouts without horizontal overflow, 44 px touch targets, collapsible navigation,
two-column desktop form.

## Manual review performed

Every screen was rendered for each role and inspected from screenshots (desktop, tablet and phone): alignment, spacing,
typography, buttons, icons, labels, error, empty and loading states, and print previews. Issues found this way and fixed
include a CSS class collision that collapsed checkbox labels, date/time inputs that consumed several Tab stops, a stale
search response overwriting newer results, and nav overflow at 1440 px.

# Architecture

## Overview

```
Browser (SPA, ES modules)  ──HTTPS──▶  nginx (TLS)  ──▶  Node.js / Express  ──▶  PostgreSQL
  • history-API router                                   • REST API /api/*       • normalised schema
  • safe templating (auto-escape)                        • sessions + RBAC       • GIN trigram / FTS indexes
  • print layouts (CSS mm)                               • zod validation        • constraints, triggers
                                                         • PDF / XLSX / CSV      • advisory locks
                                                         • background jobs  ──▶  storage/ (photos, logo)
```

- **Frontend** (`public/`): no build step. `lib/dom.js` provides an `html` tagged template that escapes every interpolated
  value, so user data can never become markup. Pages are lazy-loaded modules (`pages/*.js`). The router checks the same
  permissions the server enforces, only to decide what to offer.
- **Backend** (`server/`): Express 5 with helmet (CSP `script-src 'self'`), rate limiting, cookie sessions, CSRF protection,
  and a central error handler. Business rules live in `services/`; `routes/` only validate, authorise and call services.
- **Database**: PostgreSQL; every multi-step operation (registration + visit + check-in + pass + notifications + audit) runs
  in one transaction.

## Data model

```
roles ─< role_permissions >─ permissions
users ─> roles, users ─> employees (host users)            user_sessions ─> users

departments ─< employees
companies ─< visitors                          stored_files (photos/logo: path + sha256 + size)
visitors ─< visitor_photos, visitor_documents  visitors.photo_file_id ─> stored_files
visitors ─< visits >─ employees (host), departments, purposes, visitor_categories, access_areas, vehicles, companies
visits  ─< visit_status_history, visitor_passes, approvals, notifications
audit_logs (append-only), error_logs, system_settings, print_templates, document_counters
```

**Visitor master vs visit transaction.** `visitors` holds permanent personal data once (name, mobile, email, organisation,
designation, ID reference, photo). `visits` holds only visit-specific data (host, department, purpose, category, access area,
appointment, vehicle, declaration, verification, lifecycle timestamps, status). The host's name and designation are
snapshotted on the visit so historic official records stay accurate if the employee later changes role; the visitor's
details are never copied into visits.

**Identifiers.** Surrogate keys are internal. Public references are generated transaction-safely:
`VIS-000001` (sequence), `VST-2026-000001` and `PASS-2026-000001` (year-scoped `next_document_number()` using
`INSERT … ON CONFLICT DO UPDATE … RETURNING`, which serialises concurrent callers).

**Integrity rules enforced by the database**

| Rule | Mechanism |
|---|---|
| One active master per person | `visitors_mobile_uq` — unique (country code, mobile, normalised name) for active records |
| A visitor is on premises under at most one visit | partial unique index `visits_one_active_per_visitor` |
| One live pass per visit | partial unique index `visitor_passes_one_live_per_visit` |
| Departure never before arrival | `CHECK (check_out_at >= check_in_at)` |
| Consistent statuses | `CHECK (status IN (EXPECTED, PENDING_APPROVAL, APPROVED, CHECKED_IN, CHECKED_OUT, DENIED, CANCELLED, OVERSTAY))` |
| Unique organisation names | unique index on lower-cased, whitespace-normalised name |
| Audit log cannot be altered | `BEFORE UPDATE OR DELETE` trigger raises an error |
| Masters are soft-deleted | `deleted_at` + `is_active`; visits keep their foreign keys |

**Indexes for search** — mobile prefix (`text_pattern_ops`), mobile/name/company/employee trigram GIN (`gin_trgm_ops`, also
used for typo-tolerant `<%` word similarity), weighted `tsvector` GIN on the visitor master, plus B-tree indexes on every
foreign key, dates and statuses. Tests assert the planner uses them.

**Time.** Database sessions run in UTC; all instants are `timestamptz`. The organisation time zone (setting) is used to
compute “today”, date ranges and report dates (`appointment_date` is a local `date`), and for display.

## Visit lifecycle

```
            pre-registration                     walk-in registration
                   │                                     │
                   ▼                                     ▼
 PENDING_APPROVAL ◀── needs approval? ──▶  EXPECTED (future / pre-registered)   APPROVED (arrived)
        │ approve / reject                         │                              │
        ▼                                          └──────────── check-in ────────┤
     APPROVED / DENIED                                                            ▼
                                   CHECKED_IN ── past valid_until + grace ──▶ OVERSTAY
                                        │                                         │
                                        └──────────────── check-out ──────────────┘
                                                              ▼
                                                   CHECKED_OUT (visit closed)
 Blocked visitor at any point ──▶ DENIED     Cancel (EXPECTED / PENDING / APPROVED) ──▶ CANCELLED
```

Check-in validates readiness (declaration, ID verification for categories that require it, photo if mandatory), locks the
visit row (`SELECT … FOR UPDATE`), issues the pass, notifies the host and updates visitor statistics — atomically.

## Security model

| Control | Implementation |
|---|---|
| Passwords | scrypt (N=16384, r=8, p=1, 16-byte salt); policy configurable; timing-safe comparison; uniform timing for unknown users |
| Sessions | random 256-bit token in an `HttpOnly; SameSite=Strict` cookie (`Secure` in production); only its SHA-256 is stored; idle timeout and absolute lifetime from settings; revoked on logout, password change, role change or deactivation |
| Lockout / rate limiting | configurable failed-attempt lockout; per-IP login limiter; API limiter |
| CSRF | per-session token required in `X-CSRF-Token` for every state-changing request + Origin check + SameSite cookies |
| Authorisation | permission codes per role (`role_permissions`), checked on every endpoint; hosts are scoped to their own visits; self-demotion prevented |
| Input validation | zod schemas on every endpoint; business validation in services; DB constraints as the last line |
| SQL injection | parameterised queries only; sort columns from whitelists |
| XSS | auto-escaping templates; CSP without `unsafe-inline` scripts |
| Uploads | MIME allow-list, 5 MB limit, content decoded with sharp (pixel limit against decompression bombs), re-encoded to JPEG (strips EXIF/GPS and payloads), random file names outside the web root, served only through authorised routes |
| Privacy | ID numbers stored masked by default (last 4 characters); mobiles masked in print and for roles without edit rights; QR codes contain only a random token; configurable retention with anonymisation |
| Errors | users see “Unable to complete the request…” with a reference; details go to `error_logs` |

## REST API (summary)

| Method & path | Purpose |
|---|---|
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/change-password` | Session |
| `GET /api/visitors/search?q=` | Returning-visitor search |
| `GET /api/visitors/check-duplicate` | Duplicate check by mobile |
| `POST /api/visitors` · `GET/PUT /api/visitors/:id` · `GET /api/visitors/:id/visits` | Visitor master & history |
| `PUT /api/visitors/:id/watchlist` · `POST /api/visitors/:id/archive` | Restriction, archiving |
| `POST /api/photos` | Photo upload (returns a file id) |
| `POST /api/visits` | Registration (new or existing visitor), optional immediate check-in |
| `GET /api/visits` · `GET /api/visits/:id` | Search & history · details + timeline (`:id` may be id, visit code, pass number or token) |
| `POST /api/visits/:id/check-in` · `/check-out` · `/decision` · `/cancel` · `/print` | Lifecycle |
| `GET /api/visits/current` · `GET /api/visits/lookup` | On premises · desk lookup |
| `GET /api/visits/:id/qr.svg` · `GET /api/verify/:token` | QR code · pass verification |
| `POST /api/pre-registration` · `GET /api/approvals` | Pre-registration · approvals |
| `GET /api/reports` · `GET /api/reports/:type` · `GET /api/reports/:type/export?format=pdf\|xlsx\|csv` · `GET /api/reports/visitors` | Reports |
| `GET /api/reports/emergency` · `GET /api/reports/emergency/export` | Emergency roll call |
| `GET /api/print/visits/:id/record.pdf` · `/pass.pdf` | Server-side PDFs |
| `GET /api/dashboard/summary` · `GET /api/dashboard/analytics` | Dashboard |
| `GET/POST/PUT/DELETE /api/employees`, `/api/companies`, `/api/masters/:type` | Directories & masters |
| `GET/PUT /api/settings/*` · `/api/users` · `/api/audit-logs` · `/api/retention/*` · `/api/notifications` | Administration |

Errors use a consistent body: `{ "error": { "code", "message", "fields"? } }` with 400/401/403/404/409/413/415/422/423/429/500.

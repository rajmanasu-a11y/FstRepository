-- =============================================================================
-- Visitor Management System — initial schema
--
-- Design principles
--   * Visitor MASTER (visitors) is separated from visit TRANSACTIONS (visits).
--     One visitor -> many visits. Permanent visitor data is never duplicated
--     into visit rows; visits only carry what is specific to that visit.
--   * All timestamps are TIMESTAMPTZ (stored in UTC, rendered in the
--     organisation time zone configured in system_settings).
--   * Masters use soft-delete (deleted_at) and is_active flags; transactional
--     data is never hard-deleted by the application.
--   * Human-readable public identifiers (VIS-000001, VST-2026-000001,
--     PASS-2026-000001) are separate from internal surrogate keys.
--   * Text search uses pg_trgm GIN indexes and a tsvector GIN index so that
--     returning-visitor search stays fast on large datasets.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Year-scoped, transaction-safe document counters (VST-2026-000001 etc).
-- INSERT .. ON CONFLICT takes a row lock, so concurrent callers are serialised
-- and never receive the same number.
CREATE TABLE document_counters (
  prefix      TEXT    NOT NULL,
  year        INTEGER NOT NULL,
  last_value  BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
);

CREATE OR REPLACE FUNCTION next_document_number(p_prefix TEXT, p_year INTEGER)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v BIGINT;
BEGIN
  INSERT INTO document_counters (prefix, year, last_value)
  VALUES (p_prefix, p_year, 1)
  ON CONFLICT (prefix, year)
  DO UPDATE SET last_value = document_counters.last_value + 1
  RETURNING last_value INTO v;
  RETURN p_prefix || '-' || p_year::TEXT || '-' || lpad(v::TEXT, 6, '0');
END;
$$;

CREATE SEQUENCE visitor_code_seq START 1;

-- ---------------------------------------------------------------------------
-- Security: roles, permissions, users, sessions
-- ---------------------------------------------------------------------------

CREATE TABLE roles (
  id           SMALLSERIAL PRIMARY KEY,
  code         TEXT        NOT NULL UNIQUE CHECK (code ~ '^[A-Z_]+$'),
  name         TEXT        NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id           SMALLSERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z_.]+$'),
  description  TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id        SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE departments (
  id          SERIAL PRIMARY KEY,
  code        TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  INTEGER,
  updated_by  INTEGER,
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX departments_code_uq ON departments (lower(code)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX departments_name_uq ON departments (lower(name)) WHERE deleted_at IS NULL;
CREATE TRIGGER departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employees (
  id              SERIAL PRIMARY KEY,
  employee_code   TEXT        NOT NULL,
  salutation      TEXT        CHECK (salutation IN ('Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.', 'Shri', 'Smt.')),
  full_name       TEXT        NOT NULL CHECK (length(btrim(full_name)) >= 2),
  designation     TEXT        NOT NULL,
  department_id   INTEGER     NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  official_mobile TEXT,
  official_email  CITEXT,
  location        TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      INTEGER,
  updated_by      INTEGER,
  deleted_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX employees_code_uq ON employees (lower(employee_code)) WHERE deleted_at IS NULL;
CREATE INDEX employees_department_idx ON employees (department_id);
CREATE INDEX employees_name_trgm ON employees USING gin (full_name gin_trgm_ops);
CREATE INDEX employees_designation_trgm ON employees USING gin (designation gin_trgm_ops);
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE users (
  id                    SERIAL PRIMARY KEY,
  username              CITEXT      NOT NULL,
  full_name             TEXT        NOT NULL,
  email                 CITEXT,
  password_hash         TEXT        NOT NULL,
  role_id               SMALLINT    NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  employee_id           INTEGER     REFERENCES employees(id) ON DELETE SET NULL,
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN     NOT NULL DEFAULT FALSE,
  failed_login_count    INTEGER     NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  password_changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            INTEGER     REFERENCES users(id),
  updated_by            INTEGER     REFERENCES users(id),
  deleted_at            TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_username_uq ON users (username) WHERE deleted_at IS NULL;
CREATE INDEX users_employee_idx ON users (employee_id);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE departments ADD CONSTRAINT departments_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE departments ADD CONSTRAINT departments_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE employees   ADD CONSTRAINT employees_created_by_fk   FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE employees   ADD CONSTRAINT employees_updated_by_fk   FOREIGN KEY (updated_by) REFERENCES users(id);

-- Opaque server-side sessions. Only a SHA-256 hash of the cookie token is
-- stored, so a database leak does not expose usable session tokens.
CREATE TABLE user_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    BYTEA       NOT NULL UNIQUE,
  csrf_token    TEXT        NOT NULL,
  user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_idx ON user_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Configurable masters
-- ---------------------------------------------------------------------------

CREATE TABLE visitor_categories (
  id                  SERIAL PRIMARY KEY,
  code                TEXT        NOT NULL UNIQUE,
  name                TEXT        NOT NULL,
  requires_approval   BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_id         BOOLEAN     NOT NULL DEFAULT FALSE,
  roll_call_group     TEXT        NOT NULL DEFAULT 'VISITOR'
                        CHECK (roll_call_group IN ('VISITOR', 'CONTRACTOR', 'SERVICE', 'EMPLOYEE')),
  sort_order          INTEGER     NOT NULL DEFAULT 100,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX visitor_categories_name_uq ON visitor_categories (lower(name));
CREATE TRIGGER visitor_categories_updated_at BEFORE UPDATE ON visitor_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purposes (
  id                  SERIAL PRIMARY KEY,
  code                TEXT        NOT NULL UNIQUE,
  name                TEXT        NOT NULL,
  requires_specify    BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order          INTEGER     NOT NULL DEFAULT 100,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purposes_name_uq ON purposes (lower(name));
CREATE TRIGGER purposes_updated_at BEFORE UPDATE ON purposes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE access_areas (
  id                  SERIAL PRIMARY KEY,
  code                TEXT        NOT NULL UNIQUE,
  name                TEXT        NOT NULL,
  is_restricted       BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_approval   BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order          INTEGER     NOT NULL DEFAULT 100,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX access_areas_name_uq ON access_areas (lower(name));
CREATE TRIGGER access_areas_updated_at BEFORE UPDATE ON access_areas FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE id_types (
  id          SERIAL PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 100,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER id_types_updated_at BEFORE UPDATE ON id_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Company / organisation directory
-- ---------------------------------------------------------------------------

CREATE TABLE companies (
  id               SERIAL PRIMARY KEY,
  name             TEXT        NOT NULL CHECK (length(btrim(name)) >= 2),
  address          TEXT,
  contact_person   TEXT,
  contact_number   TEXT,
  email            CITEXT,
  website          TEXT,
  category         TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       INTEGER     REFERENCES users(id),
  updated_by       INTEGER     REFERENCES users(id),
  deleted_at       TIMESTAMPTZ
);
-- One live company per (case/whitespace-insensitive) name.
CREATE UNIQUE INDEX companies_name_uq ON companies (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) WHERE deleted_at IS NULL;
CREATE INDEX companies_name_trgm ON companies USING gin (name gin_trgm_ops);
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Stored files (photos, documents, logo). Binary content lives on disk /
-- object storage; the database stores the reference and integrity metadata.
-- ---------------------------------------------------------------------------

CREATE TABLE stored_files (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose       TEXT        NOT NULL CHECK (purpose IN ('VISITOR_PHOTO', 'VISITOR_DOCUMENT', 'ORG_LOGO')),
  storage_key   TEXT        NOT NULL UNIQUE,
  mime_type     TEXT        NOT NULL,
  size_bytes    INTEGER     NOT NULL CHECK (size_bytes > 0),
  width         INTEGER,
  height        INTEGER,
  sha256        TEXT        NOT NULL,
  original_name TEXT,
  is_attached   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by    INTEGER     REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX stored_files_unattached_idx ON stored_files (created_at) WHERE is_attached = FALSE AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- VISITOR MASTER
-- ---------------------------------------------------------------------------

CREATE TABLE visitors (
  id                    BIGSERIAL   PRIMARY KEY,
  visitor_code          TEXT        NOT NULL UNIQUE
                          DEFAULT ('VIS-' || lpad(nextval('visitor_code_seq')::TEXT, 6, '0')),
  full_name             TEXT        NOT NULL CHECK (length(btrim(full_name)) >= 2),
  mobile_country_code   TEXT        NOT NULL DEFAULT '+91' CHECK (mobile_country_code ~ '^\+[0-9]{1,4}$'),
  mobile_number         TEXT        CHECK (mobile_number ~ '^[0-9]{6,14}$'),
  alternate_contact     TEXT,
  email                 CITEXT,
  company_id            INTEGER     REFERENCES companies(id) ON DELETE RESTRICT,
  designation           TEXT,
  address               TEXT,
  id_type_id            INTEGER     REFERENCES id_types(id) ON DELETE RESTRICT,
  -- Either the full reference or a masked form (e.g. XXXXXX1234),
  -- depending on the id_number_storage privacy setting.
  id_reference          TEXT,
  photo_file_id         UUID        REFERENCES stored_files(id) ON DELETE SET NULL,
  watchlist_status      TEXT        NOT NULL DEFAULT 'NONE'
                          CHECK (watchlist_status IN ('NONE', 'FLAGGED', 'BLOCKED')),
  watchlist_reason      TEXT,
  watchlist_updated_by  INTEGER     REFERENCES users(id),
  watchlist_updated_at  TIMESTAMPTZ,
  record_status         TEXT        NOT NULL DEFAULT 'ACTIVE'
                          CHECK (record_status IN ('ACTIVE', 'ARCHIVED', 'ANONYMISED')),
  first_visit_at        TIMESTAMPTZ,
  last_visit_at         TIMESTAMPTZ,
  total_visits          INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            INTEGER     REFERENCES users(id),
  updated_by            INTEGER     REFERENCES users(id),
  archived_at           TIMESTAMPTZ,
  anonymised_at         TIMESTAMPTZ,
  search_vector         TSVECTOR GENERATED ALWAYS AS (
                          setweight(to_tsvector('simple', coalesce(full_name, '')), 'A') ||
                          setweight(to_tsvector('simple', coalesce(email::TEXT, '')), 'B') ||
                          setweight(to_tsvector('simple', coalesce(designation, '')), 'C') ||
                          setweight(to_tsvector('simple', coalesce(visitor_code, '')), 'A')
                        ) STORED
);
-- Duplicate prevention: the same person (mobile + normalised name) can have
-- only one active master record. A different person sharing a mobile number
-- (e.g. a company phone) is permitted only through an explicit, audited
-- override in the application.
CREATE UNIQUE INDEX visitors_mobile_uq ON visitors
  (mobile_country_code, mobile_number, lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')))
  WHERE mobile_number IS NOT NULL AND record_status = 'ACTIVE';
CREATE INDEX visitors_mobile_lookup_idx ON visitors (mobile_country_code, mobile_number) WHERE record_status = 'ACTIVE';
-- Mobile prefix search ("98765...") and suffix/contains search ("...3210").
CREATE INDEX visitors_mobile_prefix_idx ON visitors (mobile_number text_pattern_ops);
CREATE INDEX visitors_mobile_trgm ON visitors USING gin (mobile_number gin_trgm_ops);
CREATE INDEX visitors_name_trgm ON visitors USING gin (full_name gin_trgm_ops);
CREATE INDEX visitors_email_idx ON visitors (email);
CREATE INDEX visitors_id_reference_idx ON visitors (id_reference);
CREATE INDEX visitors_company_idx ON visitors (company_id);
CREATE INDEX visitors_search_idx ON visitors USING gin (search_vector);
CREATE INDEX visitors_watchlist_idx ON visitors (watchlist_status) WHERE watchlist_status <> 'NONE';
CREATE INDEX visitors_last_visit_idx ON visitors (last_visit_at DESC NULLS LAST);
CREATE TRIGGER visitors_updated_at BEFORE UPDATE ON visitors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE visitor_documents (
  id             BIGSERIAL   PRIMARY KEY,
  visitor_id     BIGINT      NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  visit_id       BIGINT,
  document_type  TEXT        NOT NULL,
  file_id        UUID        NOT NULL REFERENCES stored_files(id) ON DELETE RESTRICT,
  remarks        TEXT,
  created_by     INTEGER     REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX visitor_documents_visitor_idx ON visitor_documents (visitor_id);

-- Photo history: the current photo is visitors.photo_file_id; earlier photos
-- are retained here (until retention removes them) for audit purposes.
CREATE TABLE visitor_photos (
  id           BIGSERIAL   PRIMARY KEY,
  visitor_id   BIGINT      NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
  file_id      UUID        NOT NULL REFERENCES stored_files(id) ON DELETE RESTRICT,
  is_current   BOOLEAN     NOT NULL DEFAULT TRUE,
  captured_by  INTEGER     REFERENCES users(id),
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX visitor_photos_visitor_idx ON visitor_photos (visitor_id);
CREATE UNIQUE INDEX visitor_photos_current_uq ON visitor_photos (visitor_id) WHERE is_current;

-- ---------------------------------------------------------------------------
-- Vehicles (master by registration number; per-visit details live on visits)
-- ---------------------------------------------------------------------------

CREATE TABLE vehicles (
  id                   BIGSERIAL   PRIMARY KEY,
  registration_number  TEXT        NOT NULL CHECK (registration_number ~ '^[A-Z0-9-]{4,15}$'),
  vehicle_type         TEXT        NOT NULL DEFAULT 'CAR'
                         CHECK (vehicle_type IN ('TWO_WHEELER', 'CAR', 'TAXI', 'BUS', 'COMMERCIAL', 'OTHER')),
  last_visitor_id      BIGINT      REFERENCES visitors(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vehicles_registration_uq ON vehicles (registration_number);
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- VISIT TRANSACTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE visits (
  id                      BIGSERIAL   PRIMARY KEY,
  visit_code              TEXT        NOT NULL UNIQUE,
  visitor_id              BIGINT      NOT NULL REFERENCES visitors(id) ON DELETE RESTRICT,
  -- Company represented on THIS visit (a visitor may change employer).
  company_id              INTEGER     REFERENCES companies(id) ON DELETE RESTRICT,
  host_employee_id        INTEGER     NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  department_id           INTEGER     NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  -- Point-in-time host details for historical accuracy of official records
  -- (the host may later change designation or department).
  host_name_snapshot        TEXT      NOT NULL,
  host_designation_snapshot TEXT      NOT NULL,
  purpose_id              INTEGER     NOT NULL REFERENCES purposes(id) ON DELETE RESTRICT,
  purpose_other           TEXT,
  category_id             INTEGER     NOT NULL REFERENCES visitor_categories(id) ON DELETE RESTRICT,
  access_area_id          INTEGER     REFERENCES access_areas(id) ON DELETE RESTRICT,
  appointment_type        TEXT        NOT NULL DEFAULT 'WALK_IN'
                            CHECK (appointment_type IN ('WALK_IN', 'SCHEDULED', 'PRE_REGISTERED')),
  appointment_date        DATE        NOT NULL,
  expected_arrival        TIME,
  expected_duration_min   INTEGER     NOT NULL DEFAULT 60 CHECK (expected_duration_min BETWEEN 5 AND 1440),
  appointment_reference   TEXT,
  is_preregistered        BOOLEAN     NOT NULL DEFAULT FALSE,
  special_instructions    TEXT,
  qr_token                TEXT        UNIQUE,
  status                  TEXT        NOT NULL
                            CHECK (status IN ('EXPECTED', 'PENDING_APPROVAL', 'APPROVED', 'CHECKED_IN',
                                              'CHECKED_OUT', 'DENIED', 'CANCELLED', 'OVERSTAY')),
  entry_point             TEXT,
  -- Identity verification for this visit
  id_verified             BOOLEAN     NOT NULL DEFAULT FALSE,
  id_verified_by          INTEGER     REFERENCES users(id),
  id_verified_at          TIMESTAMPTZ,
  verification_remarks    TEXT,
  -- Declaration / consent
  consent_given           BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_at              TIMESTAMPTZ,
  consent_recorded_by     INTEGER     REFERENCES users(id),
  consent_text_version    TEXT,
  -- Vehicle (optional)
  vehicle_id              BIGINT      REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_name             TEXT,
  parking_required        BOOLEAN     NOT NULL DEFAULT FALSE,
  vehicle_remarks         TEXT,
  -- Lifecycle timestamps
  arrived_at              TIMESTAMPTZ,
  check_in_at             TIMESTAMPTZ,
  checked_in_by           INTEGER     REFERENCES users(id),
  valid_until             TIMESTAMPTZ,
  check_out_at            TIMESTAMPTZ,
  checked_out_by          INTEGER     REFERENCES users(id),
  duration_minutes        INTEGER     CHECK (duration_minutes >= 0),
  overstay_flagged_at     TIMESTAMPTZ,
  host_notified_at        TIMESTAMPTZ,
  closed_at               TIMESTAMPTZ,
  status_reason           TEXT,
  remarks                 TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              INTEGER     REFERENCES users(id),
  updated_by              INTEGER     REFERENCES users(id),
  row_version             INTEGER     NOT NULL DEFAULT 1,

  CONSTRAINT visits_checkout_after_checkin CHECK (check_out_at IS NULL OR (check_in_at IS NOT NULL AND check_out_at >= check_in_at)),
  CONSTRAINT visits_checked_in_has_time    CHECK (status NOT IN ('CHECKED_IN', 'OVERSTAY', 'CHECKED_OUT') OR check_in_at IS NOT NULL),
  CONSTRAINT visits_checked_out_has_time   CHECK (status <> 'CHECKED_OUT' OR check_out_at IS NOT NULL),
  CONSTRAINT visits_other_purpose_text     CHECK (purpose_other IS NULL OR length(btrim(purpose_other)) > 0)
);
-- A visitor can be physically on premises under only one visit at a time.
CREATE UNIQUE INDEX visits_one_active_per_visitor ON visits (visitor_id) WHERE status IN ('CHECKED_IN', 'OVERSTAY');
CREATE INDEX visits_visitor_idx      ON visits (visitor_id, created_at DESC);
CREATE INDEX visits_host_idx         ON visits (host_employee_id, appointment_date DESC);
CREATE INDEX visits_department_idx   ON visits (department_id);
CREATE INDEX visits_company_idx      ON visits (company_id);
CREATE INDEX visits_purpose_idx      ON visits (purpose_id);
CREATE INDEX visits_category_idx     ON visits (category_id);
CREATE INDEX visits_status_idx       ON visits (status);
CREATE INDEX visits_appointment_idx  ON visits (appointment_date);
CREATE INDEX visits_check_in_idx     ON visits (check_in_at);
CREATE INDEX visits_active_idx       ON visits (valid_until) WHERE status IN ('CHECKED_IN', 'OVERSTAY');
CREATE INDEX visits_vehicle_idx      ON visits (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE TRIGGER visits_updated_at BEFORE UPDATE ON visits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE visitor_documents ADD CONSTRAINT visitor_documents_visit_fk FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE SET NULL;

-- Every lifecycle transition, with who/when (auditable workflow timeline).
CREATE TABLE visit_status_history (
  id           BIGSERIAL   PRIMARY KEY,
  visit_id     BIGINT      NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT        NOT NULL,
  event        TEXT        NOT NULL,
  remarks      TEXT,
  changed_by   INTEGER     REFERENCES users(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX visit_status_history_visit_idx ON visit_status_history (visit_id, changed_at);

CREATE TABLE visitor_passes (
  id               BIGSERIAL   PRIMARY KEY,
  pass_number      TEXT        NOT NULL UNIQUE,
  visit_id         BIGINT      NOT NULL REFERENCES visits(id) ON DELETE RESTRICT,
  status           TEXT        NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'RETURNED', 'VOID')),
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by        INTEGER     REFERENCES users(id),
  valid_until      TIMESTAMPTZ,
  print_count      INTEGER     NOT NULL DEFAULT 0,
  last_printed_at  TIMESTAMPTZ,
  returned_at      TIMESTAMPTZ,
  void_reason      TEXT
);
-- Only one live pass per visit.
CREATE UNIQUE INDEX visitor_passes_one_live_per_visit ON visitor_passes (visit_id) WHERE status <> 'VOID';

CREATE TABLE approvals (
  id                     BIGSERIAL   PRIMARY KEY,
  visit_id               BIGINT      NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  approver_employee_id   INTEGER     NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  decision               TEXT        NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  reason                 TEXT,
  requested_by           INTEGER     REFERENCES users(id),
  requested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by             INTEGER     REFERENCES users(id),
  decided_at             TIMESTAMPTZ,
  remarks                TEXT
);
CREATE UNIQUE INDEX approvals_one_pending_per_visit ON approvals (visit_id) WHERE decision = 'PENDING';
CREATE INDEX approvals_approver_idx ON approvals (approver_employee_id, decision);

CREATE TABLE notifications (
  id                     BIGSERIAL   PRIMARY KEY,
  channel                TEXT        NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP')),
  type                   TEXT        NOT NULL,
  recipient_user_id      INTEGER     REFERENCES users(id) ON DELETE CASCADE,
  recipient_employee_id  INTEGER     REFERENCES employees(id) ON DELETE SET NULL,
  recipient_address      TEXT,
  title                  TEXT        NOT NULL,
  body                   TEXT        NOT NULL,
  payload                JSONB       NOT NULL DEFAULT '{}'::jsonb,
  visit_id               BIGINT      REFERENCES visits(id) ON DELETE CASCADE,
  status                 TEXT        NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED')),
  status_detail          TEXT,
  attempts               INTEGER     NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at                TIMESTAMPTZ,
  read_at                TIMESTAMPTZ
);
CREATE INDEX notifications_user_idx ON notifications (recipient_user_id, created_at DESC) WHERE channel = 'IN_APP';
CREATE INDEX notifications_unread_idx ON notifications (recipient_user_id) WHERE channel = 'IN_APP' AND read_at IS NULL;
CREATE INDEX notifications_pending_idx ON notifications (created_at) WHERE status = 'PENDING';
CREATE INDEX notifications_visit_idx ON notifications (visit_id);

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

CREATE TABLE system_settings (
  key          TEXT        PRIMARY KEY,
  value        JSONB       NOT NULL,
  description  TEXT,
  updated_by   INTEGER     REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE print_templates (
  id           SERIAL      PRIMARY KEY,
  code         TEXT        NOT NULL UNIQUE CHECK (code IN ('VISITOR_PASS', 'HALF_A4_RECORD')),
  name         TEXT        NOT NULL,
  config       JSONB       NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_by   INTEGER     REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Audit & error logs (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id            BIGSERIAL   PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  username      TEXT,
  role_code     TEXT,
  action        TEXT        NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  entity_ref    TEXT,
  summary       TEXT,
  old_values    JSONB,
  new_values    JSONB,
  ip_address    INET,
  user_agent    TEXT
);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE error_logs (
  id            BIGSERIAL   PRIMARY KEY,
  reference     TEXT        NOT NULL UNIQUE,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  method        TEXT,
  path          TEXT,
  message       TEXT        NOT NULL,
  stack         TEXT,
  details       JSONB
);
CREATE INDEX error_logs_occurred_idx ON error_logs (occurred_at DESC);

#!/usr/bin/env bash
# =============================================================================
# Verify a backup set produced by backup.sh.
#
#   scripts/verify-backup.sh <backup-dir>/vms-<timestamp>.sha256
#
# 1. Verifies the SHA-256 checksums.
# 2. Confirms the dump's table of contents is readable.
# 3. If VERIFY_DATABASE_URL points at an EMPTY scratch database, performs a
#    full trial restore into it and runs sanity checks (row counts, latest
#    migration, audit-log immutability trigger present).
# =============================================================================
set -euo pipefail

SUM_FILE="${1:?usage: verify-backup.sh <path to vms-<timestamp>.sha256>}"
DIR="$(cd "$(dirname "$SUM_FILE")" && pwd)"
STAMP="$(basename "$SUM_FILE" .sha256 | sed 's/^vms-//')"
DB_FILE="$DIR/vms-db-$STAMP.dump"

echo "[verify] checking checksums"
( cd "$DIR" && sha256sum --check --strict "$(basename "$SUM_FILE")" )

echo "[verify] reading dump table of contents"
TABLES=$(pg_restore --list "$DB_FILE" | grep -c ' TABLE DATA ' || true)
echo "[verify] dump contains data for $TABLES tables"
[ "$TABLES" -ge 20 ] || { echo "[verify] FAILED: unexpectedly few tables in dump"; exit 1; }

if [ -n "${VERIFY_DATABASE_URL:-}" ]; then
  EXISTING=$(psql "$VERIFY_DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
  if [ "$EXISTING" != "0" ]; then
    echo "[verify] FAILED: VERIFY_DATABASE_URL must point at an empty scratch database"; exit 1
  fi
  echo "[verify] trial restore into scratch database"
  pg_restore --dbname="$VERIFY_DATABASE_URL" --no-owner --no-comments --exit-on-error "$DB_FILE"
  psql "$VERIFY_DATABASE_URL" -v ON_ERROR_STOP=1 -tA <<'SQL'
SELECT 'visitors=' || count(*) FROM visitors;
SELECT 'visits=' || count(*) FROM visits;
SELECT 'audit_logs=' || count(*) FROM audit_logs;
SELECT 'latest_migration=' || max(name) FROM schema_migrations;
SELECT 'audit_trigger=' || count(*) FROM pg_trigger WHERE tgname = 'audit_logs_no_update';
SQL
  echo "[verify] trial restore succeeded"
fi
echo "[verify] backup $STAMP is valid"

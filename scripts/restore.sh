#!/usr/bin/env bash
# =============================================================================
# Restore a backup set produced by backup.sh.
#
#   scripts/restore.sh <backup-dir>/vms-<timestamp>.sha256 --yes
#
#   DATABASE_URL  target database (its current contents are REPLACED)
#   STORAGE_DIR   target directory for photographs (default: ./storage)
#
# Stop the application before restoring, and start it again afterwards.
# =============================================================================
set -euo pipefail

SUM_FILE="${1:?usage: restore.sh <path to vms-<timestamp>.sha256> --yes}"
[ "${2:-}" = "--yes" ] || { echo "Refusing to restore without --yes (the target database will be replaced)."; exit 2; }
: "${DATABASE_URL:?DATABASE_URL must be set}"
DIR="$(cd "$(dirname "$SUM_FILE")" && pwd)"
STAMP="$(basename "$SUM_FILE" .sha256 | sed 's/^vms-//')"
DB_FILE="$DIR/vms-db-$STAMP.dump"
FILES_FILE="$DIR/vms-files-$STAMP.tar.gz"
STORAGE_DIR="${STORAGE_DIR:-$(cd "$(dirname "$0")/.." && pwd)/storage}"

echo "[restore] verifying checksums"
( cd "$DIR" && sha256sum --check --strict "$(basename "$SUM_FILE")" )

echo "[restore] replacing database contents"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
pg_restore --dbname="$DATABASE_URL" --no-owner --no-comments --exit-on-error "$DB_FILE"

if [ -f "$FILES_FILE" ]; then
  echo "[restore] restoring uploaded files into $STORAGE_DIR"
  mkdir -p "$STORAGE_DIR"
  tar -C "$STORAGE_DIR" -xzf "$FILES_FILE"
fi
echo "[restore] completed from backup $STAMP. Start the application and review the audit log."

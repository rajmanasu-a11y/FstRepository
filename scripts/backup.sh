#!/usr/bin/env bash
# =============================================================================
# Visitor Management System – database and photo backup
#
#   DATABASE_URL   PostgreSQL connection string (required)
#   BACKUP_DIR     destination directory            (default: /var/backups/vms)
#   STORAGE_DIR    uploaded photos / logo directory (default: ./storage; skipped if absent)
#   RETENTION_DAYS delete backups older than N days (default: 30)
#
# Produces, per run:
#   vms-db-<timestamp>.dump           pg_dump custom format (compressed)
#   vms-files-<timestamp>.tar.gz      photographs and logo
#   vms-<timestamp>.sha256            checksums for both files
# Exit code is non-zero on any failure, so cron / systemd can alert.
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vms}"
STORAGE_DIR="${STORAGE_DIR:-$(cd "$(dirname "$0")/.." && pwd)/storage}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

DB_FILE="$BACKUP_DIR/vms-db-$STAMP.dump"
FILES_FILE="$BACKUP_DIR/vms-files-$STAMP.tar.gz"
SUM_FILE="$BACKUP_DIR/vms-$STAMP.sha256"

echo "[backup] $(date -u +%FT%TZ) dumping database"
pg_dump --dbname="$DATABASE_URL" --format=custom --compress=9 --no-owner --file="$DB_FILE"

if [ -d "$STORAGE_DIR" ]; then
  echo "[backup] archiving uploaded files from $STORAGE_DIR"
  tar -C "$STORAGE_DIR" -czf "$FILES_FILE" .
else
  echo "[backup] storage directory $STORAGE_DIR not found – skipping file archive"
  FILES_FILE=""
fi

( cd "$BACKUP_DIR" && sha256sum "$(basename "$DB_FILE")" ${FILES_FILE:+"$(basename "$FILES_FILE")"} > "$(basename "$SUM_FILE")" )

# Quick integrity check: the dump must be readable by pg_restore.
pg_restore --list "$DB_FILE" > /dev/null

echo "[backup] pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'vms-*' -mtime "+$RETENTION_DAYS" -print -delete

echo "[backup] completed: $DB_FILE ($(du -h "$DB_FILE" | cut -f1))${FILES_FILE:+, $FILES_FILE}"

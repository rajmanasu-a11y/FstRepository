# Backup and recovery

What must be protected:

1. **The PostgreSQL database** — every visitor, visit, pass, approval, notification, setting and the audit log.
2. **`STORAGE_DIR`** — visitor photographs and the organisation logo (the database stores only their paths and checksums).

The scripts in `scripts/` handle both. They have been executed against the demo database in the development environment:
backup → checksum verification → full trial restore into an empty scratch database → restore of photos.

## Taking a backup

```bash
DATABASE_URL=postgres://vms:…@localhost/vms BACKUP_DIR=/var/backups/vms STORAGE_DIR=/var/lib/vms/storage \
  RETENTION_DAYS=30 scripts/backup.sh
```

Each run writes, with owner-only permissions:

| File | Content |
|---|---|
| `vms-db-<UTC timestamp>.dump` | `pg_dump` custom format, compressed (restorable with `pg_restore`) |
| `vms-files-<UTC timestamp>.tar.gz` | photographs and logo |
| `vms-<UTC timestamp>.sha256` | SHA-256 of both files |

The script fails (non-zero exit) if the dump cannot be read back, and deletes sets older than `RETENTION_DAYS`.
`pg_dump` takes a consistent snapshot, so backups can run while the system is in use.

## Scheduling

systemd (templates in `deploy/`):

```bash
sudo cp deploy/vms-backup.service deploy/vms-backup.timer /etc/systemd/system/
sudo systemctl enable --now vms-backup.timer      # nightly at 01:30
systemctl list-timers vms-backup.timer            # next run
journalctl -u vms-backup.service                  # results
```

or cron:

```
30 1 * * *  vms  . /etc/vms/vms.env && BACKUP_DIR=/var/backups/vms /opt/vms/scripts/backup.sh >> /var/log/vms-backup.log 2>&1
```

Copy `BACKUP_DIR` to separate storage (another server, object storage or offline media) — a backup on the same disk
does not protect against disk loss. Encrypt off-site copies, since they contain personal data.

## Verifying backups

```bash
scripts/verify-backup.sh /var/backups/vms/vms-20260928T013000Z.sha256
```

checks the checksums and the dump's table of contents. For a full trial restore, create an **empty** scratch database owned
by the application role and run:

```bash
sudo -u postgres createdb -O vms vms_verify
VERIFY_DATABASE_URL=postgres://vms:…@localhost/vms_verify scripts/verify-backup.sh /var/backups/vms/vms-<ts>.sha256
sudo -u postgres dropdb vms_verify
```

It restores the dump and prints row counts, the latest migration and whether the audit-log protection trigger is present.
Run a trial restore at least monthly and record the result.

## Restoring

1. Stop the application: `sudo systemctl stop vms`.
2. Restore (the target database contents are **replaced**):
   ```bash
   DATABASE_URL=postgres://vms:…@localhost/vms STORAGE_DIR=/var/lib/vms/storage \
     scripts/restore.sh /var/backups/vms/vms-<ts>.sha256 --yes
   ```
3. Start the application: `sudo systemctl start vms`. Migrations newer than the backup are applied automatically.
4. Sign in as Super Administrator, check the dashboard and the latest audit entries, and record the restore.

## Disaster recovery

| Scenario | Action |
|---|---|
| Application server lost | Provision a new server, deploy the same release, restore `/etc/vms/vms.env`, point `DATABASE_URL` at the database, restore `STORAGE_DIR` from the latest `vms-files-*.tar.gz`. |
| Database server lost | Install PostgreSQL, create the role and an empty database, run `restore.sh` with the latest verified set. Data after that backup is lost unless WAL archiving is used (below). |
| Accidental data change | Restore the latest set into a *separate* database, compare, and repair specific records; the audit log shows previous and new values for most changes. |

**Recovery objectives with nightly backups:** data loss up to 24 hours (RPO), restore time typically minutes for this data
volume (RTO). For a smaller RPO, enable PostgreSQL continuous archiving (`archive_mode = on`, `archive_command`, periodic
`pg_basebackup`) to allow point-in-time recovery; that is configured on the database server and is outside these scripts.

#!/usr/bin/env bash
# Create a verified PostgreSQL backup without exposing DATABASE_URL in argv.

set -Eeuo pipefail
umask 077

BACKUP_ROOT="/var/www/eti/backups/managed"
RETENTION_DAYS="${ETI_BACKUP_RETENTION_DAYS:-3}"
REMOTE="${ETI_BACKUP_REMOTE:-}"

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || [ "$RETENTION_DAYS" -lt 1 ] || [ "$RETENTION_DAYS" -gt 30 ]; then
  echo "Invalid ETI_BACKUP_RETENTION_DAYS: expected an integer from 1 to 30" >&2
  exit 2
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
BACKUP_ROOT_REAL=$(realpath -e "$BACKUP_ROOT")
if [ "$BACKUP_ROOT_REAL" != "$BACKUP_ROOT" ]; then
  echo "Backup root must resolve exactly to $BACKUP_ROOT" >&2
  exit 2
fi

exec 9>"$BACKUP_ROOT/.backup.lock"
if ! flock -n 9; then
  echo "[$(date --iso-8601=seconds)] database backup skipped: lock busy"
  exit 0
fi

STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
TARGET="$BACKUP_ROOT/db-$STAMP"
TARGET_COMPLETE=false
mkdir -m 700 "$TARGET"

cleanup_incomplete() {
  local status=$?
  if [ "$TARGET_COMPLETE" != true ] && [ -d "$TARGET" ]; then
    local target_real
    target_real=$(realpath -e "$TARGET" 2>/dev/null || true)
    if [ -n "$target_real" ] && [ "$(dirname "$target_real")" = "$BACKUP_ROOT_REAL" ] && [[ "$(basename "$target_real")" =~ ^db-[0-9]{8}T[0-9]{6}Z$ ]]; then
      find "$target_real" -mindepth 1 -maxdepth 1 -type f -delete
      rmdir "$target_real" 2>/dev/null || true
    fi
  fi
  exit "$status"
}
trap cleanup_incomplete EXIT

mapfile -d '' -t PG_VALUES < <(python3 - <<'PY'
import os
import sys
from urllib.parse import parse_qs, unquote, urlsplit

parsed = urlsplit(os.environ["DATABASE_URL"])
if parsed.scheme not in {"postgres", "postgresql"}:
    raise SystemExit("DATABASE_URL must use postgres:// or postgresql://")
database = unquote(parsed.path.lstrip("/"))
user = unquote(parsed.username or "")
if not database or not user:
    raise SystemExit("DATABASE_URL must include user and database")
query = parse_qs(parsed.query)
values = [
    parsed.hostname or "",
    str(parsed.port or 5432),
    user,
    unquote(parsed.password or ""),
    database,
    query.get("sslmode", [""])[0],
]
sys.stdout.buffer.write(b"\0".join(value.encode() for value in values) + b"\0")
PY
)
if [ "${#PG_VALUES[@]}" -ne 6 ]; then
  echo "Failed to parse DATABASE_URL" >&2
  exit 2
fi

export PGHOST="${PG_VALUES[0]}"
export PGPORT="${PG_VALUES[1]}"
export PGUSER="${PG_VALUES[2]}"
export PGPASSWORD="${PG_VALUES[3]}"
export PGDATABASE="${PG_VALUES[4]}"
if [ -n "${PG_VALUES[5]}" ]; then
  export PGSSLMODE="${PG_VALUES[5]}"
fi
unset DATABASE_URL PG_VALUES

echo "[$(date --iso-8601=seconds)] creating PostgreSQL backup in $TARGET"
pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file "$TARGET/database.dump.partial"
pg_restore --list "$TARGET/database.dump.partial" > "$TARGET/restore.list.partial"
mv "$TARGET/database.dump.partial" "$TARGET/database.dump"
mv "$TARGET/restore.list.partial" "$TARGET/restore.list"
(
  cd "$TARGET"
  sha256sum database.dump restore.list > SHA256SUMS
  sha256sum --check SHA256SUMS
)
printf 'created_at_utc=%s\npostgres_database=%s\nrestore_list_verified=true\n' \
  "$STAMP" "$PGDATABASE" > "$TARGET/manifest.txt"
chmod 600 "$TARGET"/*
TARGET_COMPLETE=true
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE

if [ -n "$REMOTE" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "ETI_BACKUP_REMOTE is configured but rclone is not installed" >&2
    exit 1
  fi
  rclone copy "$TARGET" "${REMOTE%/}/$(basename "$TARGET")" --checksum --immutable
  echo "[$(date --iso-8601=seconds)] offsite backup copied to configured remote"
else
  echo "[$(date --iso-8601=seconds)] offsite=not_configured"
fi

while IFS= read -r -d '' old_backup; do
  old_real=$(realpath -e "$old_backup")
  old_name=$(basename "$old_real")
  if [ "$(dirname "$old_real")" != "$BACKUP_ROOT_REAL" ] || [[ ! "$old_name" =~ ^db-[0-9]{8}T[0-9]{6}Z$ ]]; then
    echo "Refusing to remove unexpected backup path: $old_backup" >&2
    exit 1
  fi
  find "$old_real" -mindepth 1 -maxdepth 1 -type f -delete
  rmdir "$old_real"
  echo "[$(date --iso-8601=seconds)] expired backup removed: $old_name"
done < <(find "$BACKUP_ROOT_REAL" -mindepth 1 -maxdepth 1 -type d -name 'db-*' -mtime "+$RETENTION_DAYS" -print0)

echo "[$(date --iso-8601=seconds)] database backup complete: $TARGET"

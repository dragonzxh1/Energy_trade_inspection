#!/usr/bin/env bash

set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "Run as root: sudo bash scripts/install-database-backup.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
UNIT_DIR="$REPO_ROOT/deploy/systemd"

install -d -o root -g root -m 0755 /usr/local/lib/eti-backup
install -o root -g root -m 0755 "$SCRIPT_DIR/backup-database.sh" /usr/local/lib/eti-backup/backup-database.sh
install -d -o ubuntu -g ubuntu -m 0700 /var/www/eti/backups/managed

for unit in eti-database-backup.service eti-database-backup.timer eti-database-backup-failure.service; do
  install -o root -g root -m 0644 "$UNIT_DIR/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now eti-database-backup.timer
systemctl --no-pager status eti-database-backup.timer

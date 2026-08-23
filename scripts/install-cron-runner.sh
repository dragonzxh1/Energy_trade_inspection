#!/usr/bin/env bash
# Install the reviewed runner outside the application-writable repository.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run this installer as root" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/cron-runner.sh"
DEST_DIR="/usr/local/lib/eti-cron"
DEST="$DEST_DIR/cron-runner.sh"

install -d -o root -g root -m 0755 "$DEST_DIR"
install -o root -g root -m 0755 "$SOURCE" "$DEST"

echo "Installed $DEST"
sha256sum "$SOURCE" "$DEST"
echo "Run scripts/setup-crontab.sh as the ETI application user."

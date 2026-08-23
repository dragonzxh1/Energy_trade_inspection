#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${ETI_APP_DIR:-/var/www/eti/Energy_trade_inspection}"
UNIT_SOURCE="$APP_DIR/deploy/systemd"
TELEGRAM_ROOT="$APP_DIR/tmp/telegram"
LEGACY_SESSION="$TELEGRAM_ROOT/eti_telegram.session"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi
if [ ! -f "$LEGACY_SESSION" ]; then
  echo "Missing authorized Telegram session: $LEGACY_SESSION" >&2
  exit 1
fi

install -d -o ubuntu -g ubuntu "$TELEGRAM_ROOT"
for stream in digital summary; do
  target="$TELEGRAM_ROOT/eti_telegram_${stream}.session"
  if [ ! -f "$target" ]; then
    install -o ubuntu -g ubuntu -m 0660 "$LEGACY_SESSION" "$target"
  fi
done

for unit in \
  eti-telegram-ingest-digital.service \
  eti-telegram-ingest-summary.service \
  eti-telegram-collector-health.service \
  eti-telegram-collector-health.timer
do
  install -m 0644 "$UNIT_SOURCE/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl disable --now eti-telegram-ingest.service 2>/dev/null || true
systemctl disable --now eti-telegram-ingest-digital.service 2>/dev/null || true
systemctl disable --now eti-telegram-ingest-summary.service 2>/dev/null || true
systemctl disable --now eti-telegram-collector-health.timer 2>/dev/null || true

sudo -u ubuntu ETI_CRON_RUNNER="$APP_DIR/scripts/cron-runner.sh" \
  bash "$APP_DIR/scripts/setup-crontab.sh"
echo "Continuous Telegram collectors are disabled; three daily cron runs are installed."

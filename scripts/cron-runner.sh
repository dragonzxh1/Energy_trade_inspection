#!/usr/bin/env bash
# cron-runner.sh — wrapper for ETI scheduled tasks
# Usage: scripts/cron-runner.sh <task>
#   tasks: cleanup | sync-sanctions | sync-fraud

set -euo pipefail

APP_DIR="/var/www/eti/Energy_trade_inspection"
ENV_FILE="$APP_DIR/.env.local"
LOG_DIR="/var/log/eti"
TASK="${1:-}"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${TASK}.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] Starting task: $TASK" >> "$LOG_FILE"

# Load environment variables from .env.local
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "[$TIMESTAMP] ERROR: $ENV_FILE not found" >> "$LOG_FILE"
  exit 1
fi

APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"

case "$TASK" in
  cleanup)
    RESULT=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
      -H "Authorization: Bearer $ADMIN_SECRET" \
      "$APP_URL/api/cron/cleanup")
    HTTP_STATUS=$(echo "$RESULT" | grep "HTTP_STATUS:" | cut -d: -f2)
    BODY=$(echo "$RESULT" | grep -v "HTTP_STATUS:")
    echo "[$TIMESTAMP] cleanup → HTTP $HTTP_STATUS: $BODY" >> "$LOG_FILE"
    ;;

  sync-sanctions)
    cd "$APP_DIR"
    node scripts/sync-opensanctions.mjs >> "$LOG_FILE" 2>&1
    echo "[$TIMESTAMP] sync-sanctions done" >> "$LOG_FILE"
    ;;

  sync-fraud)
    cd "$APP_DIR"
    node scripts/sync-fraud-alerts.mjs >> "$LOG_FILE" 2>&1
    echo "[$TIMESTAMP] sync-fraud done" >> "$LOG_FILE"
    ;;

  *)
    echo "[$TIMESTAMP] ERROR: unknown task '$TASK'" >> "$LOG_FILE"
    echo "Usage: $0 <cleanup|sync-sanctions|sync-fraud>" >&2
    exit 1
    ;;
esac

echo "[$TIMESTAMP] Task '$TASK' completed" >> "$LOG_FILE"

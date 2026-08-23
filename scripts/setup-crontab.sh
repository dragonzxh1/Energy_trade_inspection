#!/usr/bin/env bash
# setup-crontab.sh - Install ETI scheduled tasks into crontab.
#
# Safe to run multiple times. Only the complete ETI managed block is replaced;
# every non-ETI line is preserved byte-for-line and remains ahead of the block.
# Run as the user that owns the ETI process (same user as PM2).
#
# Usage:
#   bash scripts/setup-crontab.sh
#   ETI_CRON_ALLOW_UNMANAGED_RUNNER=1 ETI_CRON_RUNNER=./scripts/cron-runner.sh bash scripts/setup-crontab.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECURE_RUNNER="/usr/local/lib/eti-cron/cron-runner.sh"
RUNNER="${ETI_CRON_RUNNER:-$SECURE_RUNNER}"

if [ ! -x "$RUNNER" ]; then
  echo "ERROR: cron runner is not executable: $RUNNER" >&2
  echo "Install it first with: sudo bash $SCRIPT_DIR/install-cron-runner.sh" >&2
  exit 1
fi

if [ "${ETI_CRON_ALLOW_UNMANAGED_RUNNER:-0}" != "1" ]; then
  RESOLVED_RUNNER="$(readlink -f "$RUNNER")"
  if [ "$RESOLVED_RUNNER" != "$SECURE_RUNNER" ]; then
    echo "ERROR: production crontab must use $SECURE_RUNNER" >&2
    exit 1
  fi
  if [ "$(stat -c '%U:%G' "$RESOLVED_RUNNER")" != "root:root" ]; then
    echo "ERROR: secure cron runner must be owned by root:root" >&2
    exit 1
  fi
  if find "$RESOLVED_RUNNER" -perm /022 -print -quit | grep -q .; then
    echo "ERROR: secure cron runner must not be group/world writable" >&2
    exit 1
  fi
fi

BEGIN_MARKER="# BEGIN ETI MANAGED TASKS"
END_MARKER="# END ETI MANAGED TASKS"

declare -A TASKS
TASK_KEYS=(cleanup sync-sanctions sync-fraud gleif-delta cleanup-telegram-files daily-intelligence telegram-collect-morning telegram-collect-midday telegram-collect-afternoon fuelsight-prices-morning fuelsight-prices-afternoon fuelsight-prices-evening price-reconcile summary-publish digit-publish)
TASKS["cleanup"]="20 2 * * 0 $RUNNER cleanup # ETI_TASK:cleanup"
TASKS["sync-sanctions"]="30 1 * * 1 $RUNNER sync-sanctions # ETI_TASK:sync-sanctions"
TASKS["sync-fraud"]="15 4 * * * $RUNNER sync-fraud # ETI_TASK:sync-fraud"
TASKS["gleif-delta"]="0 2 * * * $RUNNER gleif-delta # ETI_TASK:gleif-delta"
TASKS["cleanup-telegram-files"]="30 2 * * * $RUNNER cleanup-telegram-files # ETI_TASK:cleanup-telegram-files"
TASKS["daily-intelligence"]="30 4 * * * $RUNNER daily-intelligence # ETI_TASK:daily-intelligence"
TASKS["telegram-collect-morning"]="30 8 * * * $RUNNER telegram-collect morning # ETI_TASK:telegram-collect-morning"
TASKS["telegram-collect-midday"]="0 13 * * * $RUNNER telegram-collect midday # ETI_TASK:telegram-collect-midday"
TASKS["telegram-collect-afternoon"]="30 18 * * * $RUNNER telegram-collect afternoon # ETI_TASK:telegram-collect-afternoon"
TASKS["fuelsight-prices-morning"]="30 10 * * 1-5 $RUNNER fuelsight-prices morning # ETI_TASK:fuelsight-prices-morning"
TASKS["fuelsight-prices-afternoon"]="30 14 * * 1-5 $RUNNER fuelsight-prices afternoon # ETI_TASK:fuelsight-prices-afternoon"
TASKS["fuelsight-prices-evening"]="15 18 * * 1-5 $RUNNER fuelsight-prices evening # ETI_TASK:fuelsight-prices-evening"
TASKS["price-reconcile"]="40 18 * * 1-5 $RUNNER price-reconcile # ETI_TASK:price-reconcile"
TASKS["summary-publish"]="0 19 * * * $RUNNER summary-publish # ETI_TASK:summary-publish"
TASKS["digit-publish"]="0 7 * * * $RUNNER digit-publish # ETI_TASK:digit-publish"

CURRENT=$(crontab -l 2>/dev/null || true)
NON_ETI=$(printf "%s\n" "$CURRENT" | awk \
  -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
    $0 == begin { managed=1; next }
    $0 == end { managed=0; next }
    managed { next }
    /# ETI_TASK:/ { next }
    { print }
  ')

MANAGED_BLOCK="$BEGIN_MARKER"$'\n'"CRON_TZ=Asia/Singapore"
for KEY in "${TASK_KEYS[@]}"; do
  MANAGED_BLOCK="${MANAGED_BLOCK}"$'\n'"${TASKS[$KEY]}"
done
MANAGED_BLOCK="${MANAGED_BLOCK}"$'\n'"$END_MARKER"

if [ -n "$NON_ETI" ]; then
  UPDATED_CRONTAB="${NON_ETI}"$'\n'"${MANAGED_BLOCK}"
else
  UPDATED_CRONTAB="$MANAGED_BLOCK"
fi

if [ "$CURRENT" = "$UPDATED_CRONTAB" ]; then
  echo ""
  echo "Nothing to do - ETI managed block already up to date."
  exit 0
fi

printf "%s\n" "$UPDATED_CRONTAB" | crontab -

echo ""
echo "Done. Replaced ETI managed block; non-ETI lines were preserved."
echo "Current crontab:"
echo "------------------------------------------------------------"
crontab -l

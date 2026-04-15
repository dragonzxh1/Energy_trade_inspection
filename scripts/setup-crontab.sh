#!/usr/bin/env bash
# setup-crontab.sh — Install ETI scheduled tasks into crontab.
#
# Safe to run multiple times — existing entries with the same task key are
# replaced (not duplicated) so schedule changes take effect on re-run.
# Run as the user that owns the ETI process (same user as PM2).
#
# Usage:
#   bash scripts/setup-crontab.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/cron-runner.sh"

if [ ! -x "$RUNNER" ]; then
  chmod +x "$RUNNER"
fi

# ── Cron entries to install ───────────────────────────────────────────────────
# Format: "TASK_KEY|SCHEDULE COMMAND"
# TASK_KEY is used for deduplication — existing lines containing the same key
# are removed before the new entry is added, so schedule changes take effect.

declare -A TASKS
TASKS["cleanup"]="0 3 * * 0 $RUNNER cleanup"
TASKS["sync-sanctions"]="0 2 * * 1 $RUNNER sync-sanctions"
TASKS["sync-fraud"]="15 4 * * * $RUNNER sync-fraud"

# ── Install ───────────────────────────────────────────────────────────────────

CURRENT=$(crontab -l 2>/dev/null || true)
ADDED=0
UPDATED=0

for KEY in "${!TASKS[@]}"; do
  ENTRY="${TASKS[$KEY]}"
  FULL_CMD="$RUNNER $KEY"

  if echo "$CURRENT" | grep -qF "$FULL_CMD"; then
    # Check if the existing line matches exactly (schedule may differ)
    if echo "$CURRENT" | grep -qxF "$ENTRY"; then
      echo "  [skip]    $KEY — already up to date"
    else
      # Remove old line and add new one (schedule changed)
      CURRENT=$(echo "$CURRENT" | grep -vF "$FULL_CMD")
      CURRENT="${CURRENT}"$'\n'"$ENTRY"
      echo "  [update]  $KEY — schedule changed: $ENTRY"
      UPDATED=$((UPDATED + 1))
    fi
  else
    CURRENT="${CURRENT}"$'\n'"$ENTRY"
    echo "  [add]     $KEY — $ENTRY"
    ADDED=$((ADDED + 1))
  fi
done

if [ "$ADDED" -eq 0 ] && [ "$UPDATED" -eq 0 ]; then
  echo ""
  echo "Nothing to do — all entries already up to date."
  exit 0
fi

echo "$CURRENT" | crontab -

echo ""
echo "Done ($ADDED added, $UPDATED updated). Current crontab:"
echo "------------------------------------------------------------"
crontab -l

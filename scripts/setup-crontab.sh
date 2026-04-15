#!/usr/bin/env bash
# setup-crontab.sh — Install ETI scheduled tasks into crontab.
#
# Safe to run multiple times — each entry is only added once.
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
# Format: "SCHEDULE COMMAND"
# Tweak the schedule here if needed.

ENTRIES=(
  # Cleanup old sessions (>90 days) — every Sunday at 03:00
  "0 3 * * 0 $RUNNER cleanup"

  # Fraud alert sync (storagespoofing, fuelscamalert) — daily at 04:15
  "15 4 * * * $RUNNER sync-fraud"
)

# ── Install ───────────────────────────────────────────────────────────────────

CURRENT=$(crontab -l 2>/dev/null || true)
ADDED=0

for ENTRY in "${ENTRIES[@]}"; do
  # Match on the command part only (ignore schedule changes)
  COMMAND=$(echo "$ENTRY" | awk '{print $6}' | xargs)
  if echo "$CURRENT" | grep -qF "$COMMAND"; then
    echo "  [skip]  already installed: $ENTRY"
  else
    CURRENT="${CURRENT}"$'\n'"$ENTRY"
    echo "  [add]   $ENTRY"
    ADDED=$((ADDED + 1))
  fi
done

if [ "$ADDED" -eq 0 ]; then
  echo ""
  echo "Nothing to do — all entries already installed."
  exit 0
fi

echo "$CURRENT" | crontab -

echo ""
echo "Installed $ADDED new cron entry/entries. Current crontab:"
echo "------------------------------------------------------------"
crontab -l

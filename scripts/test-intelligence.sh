#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/eti/Energy_trade_inspection}"
PYTHON_BIN="${PYTHON_BIN:-$APP_DIR/.venv-intelligence/bin/python}"
TEST_ROOT=$(mktemp -d /tmp/eti-intelligence-tests.XXXXXX)
trap 'rm -rf -- "$TEST_ROOT"' EXIT

export ETI_DISABLE_NOTIFICATIONS=1
export OBSIDIAN_VAULT="$TEST_ROOT/obsidian-vault"
export ETI_REPORTS_ROOT="$OBSIDIAN_VAULT/reports"
export DAILY_PRICE_ROOT="$ETI_REPORTS_ROOT/prices"
unset DAILY_PRICE_MODE MARKET_PIPELINE_MODE
mkdir -p "$ETI_REPORTS_ROOT"

cd "$APP_DIR"
exec "$PYTHON_BIN" -m unittest discover -s intelligence -p 'test_*.py'

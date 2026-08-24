#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${ETI_REPO_ROOT:-/var/www/eti/Energy_trade_inspection}"
SERVICE_DIR="$REPO_ROOT/web-research-agent"
UNIT_SOURCE="$REPO_ROOT/deploy/systemd/eti-web-research-agent.service"
UNIT_TARGET="/etc/systemd/system/eti-web-research-agent.service"

cd "$SERVICE_DIR"
npm run bootstrap
npm install --include=dev --ignore-scripts
npm run build
npm test
chown -R www-data:www-data "$SERVICE_DIR"

install -m 0644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl daemon-reload

if grep -qE '^FIRECRAWL_API_KEY=.+$' "$REPO_ROOT/.env.local" \
  && grep -qE '^DEEPSEEK_FLASH_AGENT_API_KEY=.+$' "$REPO_ROOT/.env.local"; then
  systemctl enable --now eti-web-research-agent.service
  curl --fail --silent http://127.0.0.1:4318/healthz
  printf '\nETI web research agent installed and healthy.\n'
else
  systemctl disable --now eti-web-research-agent.service 2>/dev/null || true
  printf 'Installed but not started: add FIRECRAWL_API_KEY and DEEPSEEK_FLASH_AGENT_API_KEY.\n'
fi

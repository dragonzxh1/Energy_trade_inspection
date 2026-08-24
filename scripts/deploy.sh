#!/usr/bin/env bash
# Prepare a fresh production candidate; activation remains an explicit operation.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RELEASE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
RELEASES_ROOT=$(realpath -e /var/www/eti/releases)
CURRENT_LINK=/var/www/eti/Energy_trade_inspection

case "$RELEASE_DIR" in
  "$RELEASES_ROOT"/*) ;;
  *)
    echo "Refusing deployment outside the production releases directory: $RELEASE_DIR" >&2
    exit 2
    ;;
esac

if [ -e "$CURRENT_LINK" ] && [ "$(realpath -e "$CURRENT_LINK")" = "$RELEASE_DIR" ]; then
  echo "Refusing in-place deployment of the active production release" >&2
  echo "Clone a fresh commit under $RELEASES_ROOT and run its scripts/deploy.sh" >&2
  exit 2
fi

cd "$RELEASE_DIR"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Refusing to prepare a candidate with tracked working-tree changes" >&2
  exit 2
fi

npm ci
bash scripts/build-production-release.sh

if [ -f web-research-agent/package.json ]; then
  npm run bootstrap --prefix web-research-agent
  npm ci --ignore-scripts --prefix web-research-agent
  npm test --prefix web-research-agent
fi

bash scripts/install-runtime-resources.sh --phase post-build
python3 scripts/verify-runtime-resources.py

echo "production candidate verified: $RELEASE_DIR"
echo "activation was not performed"

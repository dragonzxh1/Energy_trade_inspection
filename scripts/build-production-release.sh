#!/usr/bin/env bash
# Build a fresh release without exposing production runtime credentials to Next.js.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RELEASE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
MANIFEST="$RELEASE_DIR/deploy/runtime-resources.tsv"

while IFS=$'\t' read -r phase kind mode owner destination source scan_policy extra; do
  phase="${phase%$'\r'}"
  [ -z "$phase" ] && continue
  [[ "$phase" == \#* ]] && continue
  if [ -n "${extra:-}" ] || [ -z "${scan_policy%$'\r'}" ]; then
    echo "Invalid runtime resource manifest row" >&2
    exit 2
  fi
  if [ -e "$RELEASE_DIR/$destination" ] || [ -L "$RELEASE_DIR/$destination" ]; then
    echo "Refusing credential-isolated build: runtime resource is already mounted: $destination" >&2
    exit 2
  fi
done < "$MANIFEST"

env -i \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="${USER:-ubuntu}" \
  CI=1 \
  NEXT_TELEMETRY_DISABLED=1 \
  DATABASE_URL="postgresql://build:build@127.0.0.1:1/build" \
  AUTH_SECRET="build-only-not-a-secret" \
  STRIPE_SECRET_KEY="sk_test_build_only_not_a_real_key_000000" \
  QWEN_API_KEY="build-only-not-a-real-key" \
  QWEN_BASE_URL="http://127.0.0.1:1/v1" \
  NEXT_PUBLIC_APP_URL="https://etiverify.com" \
  npm run build

CACHE_PATH="$RELEASE_DIR/.next/cache"
if [ -d "$CACHE_PATH" ]; then
  if [ -L "$CACHE_PATH" ] || [ "$(realpath -e "$CACHE_PATH")" != "$RELEASE_DIR/.next/cache" ]; then
    echo "Refusing to remove unexpected Next.js cache path" >&2
    exit 2
  fi
  find "$CACHE_PATH" -depth -delete
fi

echo "credential-isolated production build complete"

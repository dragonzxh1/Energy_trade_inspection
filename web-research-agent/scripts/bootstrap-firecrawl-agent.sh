#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT_DIR/vendor/firecrawl-web-agent"
REPOSITORY="https://github.com/firecrawl/web-agent.git"
REVISION="f023adf1cd1f731e27fdc844af62996f6c2a41c4"
NPM_REGISTRY="https://registry.npmjs.org"

if [[ -d "$VENDOR_DIR/.git" ]]; then
  git -c safe.directory="$VENDOR_DIR" -C "$VENDOR_DIR" fetch --depth 1 origin "$REVISION"
  git -c safe.directory="$VENDOR_DIR" -C "$VENDOR_DIR" checkout --detach "$REVISION"
else
  mkdir -p "$(dirname "$VENDOR_DIR")"
  git clone --filter=blob:none --no-checkout "$REPOSITORY" "$VENDOR_DIR"
  git -c safe.directory="$VENDOR_DIR" -C "$VENDOR_DIR" fetch --depth 1 origin "$REVISION"
  git -c safe.directory="$VENDOR_DIR" -C "$VENDOR_DIR" checkout --detach "$REVISION"
fi

CORE_DIR="$VENDOR_DIR/agent-core"
npm install --ignore-scripts --registry="$NPM_REGISTRY" --prefix "$CORE_DIR"
npm install --ignore-scripts --registry="$NPM_REGISTRY" --save-dev --prefix "$CORE_DIR" \
  @ai-sdk/openai@3.0.90 @ai-sdk/anthropic@3.0.104 @ai-sdk/google@3.0.103

apply_patch_once() {
  local patch_file="$1"
  if git -C "$VENDOR_DIR" apply --check "$patch_file"; then
    git -C "$VENDOR_DIR" apply "$patch_file"
  elif git -C "$VENDOR_DIR" apply --reverse --check "$patch_file"; then
    printf 'Patch already applied: %s\n' "$(basename "$patch_file")"
  else
    printf 'Patch does not match pinned vendor source: %s\n' "$patch_file" >&2
    exit 1
  fi
}

apply_patch_once "$ROOT_DIR/patches/agent-core-quick-mode.patch"
apply_patch_once "$ROOT_DIR/patches/agent-core-quick-runtime.patch"
node - "$CORE_DIR/tsup.config.ts" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const source = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file, source.replace('dts: true', 'dts: false'))
NODE
npm run build --prefix "$CORE_DIR"
node "$ROOT_DIR/scripts/patch-agent-core-esm.mjs" "$CORE_DIR/dist"
node - "$CORE_DIR/package.json" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
manifest.exports = { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }
manifest.main = './dist/index.js'
manifest.types = './dist/index.d.ts'
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
NODE
printf 'Firecrawl web-agent pinned at %s\n' "$REVISION"

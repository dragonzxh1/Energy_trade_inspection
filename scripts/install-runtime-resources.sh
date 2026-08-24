#!/usr/bin/env bash
# Mount reviewed shared resources into a fresh release without copying secrets.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
MANIFEST="$REPO_ROOT/deploy/runtime-resources.tsv"
RELEASE_DIR="$REPO_ROOT"
PHASE="all"
SHARED_ROOT="/var/www/eti/shared"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --phase)
      PHASE="${2:-}"
      shift 2
      ;;
    --release-dir)
      RELEASE_DIR="${2:-}"
      shift 2
      ;;
    --manifest)
      MANIFEST="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$PHASE" in
  pre-build|post-build|all) ;;
  *)
    echo "Invalid phase: $PHASE" >&2
    exit 2
    ;;
esac

RELEASE_REAL=$(realpath -e "$RELEASE_DIR")
SHARED_REAL=$(realpath -e "$SHARED_ROOT")
if [ ! -f "$MANIFEST" ]; then
  echo "Runtime resource manifest not found: $MANIFEST" >&2
  exit 2
fi

installed=0
while IFS=$'\t' read -r resource_phase kind required_mode required_owner destination source scan_policy extra; do
  resource_phase="${resource_phase%$'\r'}"
  [ -z "$resource_phase" ] && continue
  [[ "$resource_phase" == \#* ]] && continue
  scan_policy="${scan_policy%$'\r'}"

  if [ -n "${extra:-}" ] || [ -z "$scan_policy" ]; then
    echo "Invalid runtime resource row for destination: ${destination:-unknown}" >&2
    exit 2
  fi
  if [ "$PHASE" != all ] && [ "$resource_phase" != "$PHASE" ]; then
    continue
  fi
  case "$resource_phase" in pre-build|post-build) ;; *) echo "Invalid resource phase" >&2; exit 2 ;; esac
  case "$kind" in file|directory) ;; *) echo "Invalid resource kind for $destination" >&2; exit 2 ;; esac
  case "$destination" in
    /*|..|../*|*/../*|*/..)
      echo "Unsafe runtime destination: $destination" >&2
      exit 2
      ;;
  esac
  case "$source" in
    "$SHARED_ROOT"/*) ;;
    *)
      echo "Runtime source is outside the shared root: $source" >&2
      exit 2
      ;;
  esac
  if [ -L "$source" ]; then
    echo "Runtime source must not itself be a symlink: $source" >&2
    exit 2
  fi

  SOURCE_REAL=$(realpath -e "$source")
  case "$SOURCE_REAL" in
    "$SHARED_REAL"/*) ;;
    *)
      echo "Resolved runtime source escaped the shared root: $source" >&2
      exit 2
      ;;
  esac
  if [ "$kind" = file ] && [ ! -f "$SOURCE_REAL" ]; then
    echo "Required runtime file is missing: $source" >&2
    exit 2
  fi
  if [ "$kind" = directory ] && [ ! -d "$SOURCE_REAL" ]; then
    echo "Required runtime directory is missing: $source" >&2
    exit 2
  fi

  actual_mode=$(stat -c '%a' "$SOURCE_REAL")
  actual_owner=$(stat -c '%U:%G' "$SOURCE_REAL")
  if [ "$actual_mode" != "$required_mode" ] || [ "$actual_owner" != "$required_owner" ]; then
    echo "Runtime resource metadata mismatch: $source expected=$required_mode/$required_owner actual=$actual_mode/$actual_owner" >&2
    exit 2
  fi

  DESTINATION_PATH="$RELEASE_REAL/$destination"
  DESTINATION_PARENT=$(realpath -e "$(dirname "$DESTINATION_PATH")")
  case "$DESTINATION_PARENT" in
    "$RELEASE_REAL"|"$RELEASE_REAL"/*) ;;
    *)
      echo "Runtime destination escaped the release: $destination" >&2
      exit 2
      ;;
  esac

  if [ -L "$DESTINATION_PATH" ]; then
    if [ "$(realpath -e "$DESTINATION_PATH")" != "$SOURCE_REAL" ]; then
      echo "Runtime link points to an unexpected source: $destination" >&2
      exit 2
    fi
    echo "verified runtime link: $destination"
  elif [ -e "$DESTINATION_PATH" ]; then
    echo "Refusing to overwrite non-symlink runtime destination: $destination" >&2
    exit 2
  else
    ln -s "$SOURCE_REAL" "$DESTINATION_PATH"
    echo "installed runtime link: $destination"
  fi
  installed=$((installed + 1))
done < "$MANIFEST"

echo "runtime resources ready: phase=$PHASE count=$installed"

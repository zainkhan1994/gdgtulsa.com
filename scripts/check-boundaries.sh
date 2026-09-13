#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

for legacy in assets data vendor cloud infrastructure; do
  if test -e "$ROOT/$legacy"; then
    printf 'Legacy root directory is not allowed: %s\n' "$legacy" >&2
    exit 1
  fi
done

for required in \
  "$ROOT/src/frontend/pages" \
  "$ROOT/src/frontend/assets/css" \
  "$ROOT/src/frontend/assets/js" \
  "$ROOT/src/frontend/assets/images" \
  "$ROOT/src/frontend/data" \
  "$ROOT/src/backend/services" \
  "$ROOT/tests/backend/services" \
  "$ROOT/infra/terraform"; do
  if ! test -d "$required"; then
    printf 'Required boundary is missing: %s\n' "$required" >&2
    exit 1
  fi
done

printf '%s\n' 'Repository boundaries are valid'

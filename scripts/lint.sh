#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

"$ROOT/scripts/check-boundaries.sh"
python3 -m compileall -q "$ROOT/src/backend" "$ROOT/tests/backend"
"$ROOT/scripts/build.sh"
"$ROOT/scripts/check-frontend.sh"

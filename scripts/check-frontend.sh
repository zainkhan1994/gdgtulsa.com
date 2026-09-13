#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD="$ROOT/build"

python3 - "$BUILD" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
missing = []
for page in root.glob("*.html"):
    for value in re.findall(r'(?:src|href|poster)="(/[^"?#]+)', page.read_text(encoding="utf-8")):
        if not (root / value.lstrip("/")).exists():
            missing.append(f"{page}: {value}")

if missing:
    print("Missing generated frontend references:")
    print("\n".join(missing))
    raise SystemExit(1)

print(f"Checked {len(list(root.glob('*.html')))} generated pages")
PY

#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

"$ROOT/scripts/build.sh"
printf '%s\n' 'The GitHub Pages workflow deploys the generated build/ artifact on pushes to main.'

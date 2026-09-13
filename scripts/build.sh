#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FRONTEND="$ROOT/src/frontend"
BUILD="$ROOT/build"

rm -rf "$BUILD"
mkdir -p "$BUILD/assets" "$BUILD/data" "$BUILD/vendor"

cp "$FRONTEND"/pages/*.html "$BUILD"/
cp "$FRONTEND"/assets/css/*.css "$BUILD"/
cp "$FRONTEND"/assets/images/favicon.svg "$BUILD"/
cp "$FRONTEND"/assets/js/consent.js "$BUILD"/
cp "$FRONTEND"/assets/js/firebase-config.js "$BUILD"/
cp "$FRONTEND"/assets/js/globe.js "$BUILD"/
cp "$FRONTEND"/assets/js/script.js "$BUILD"/
cp "$FRONTEND"/assets/js/tracker.js "$BUILD"/
for file in "$FRONTEND"/assets/js/*.js; do
	case "$file" in
		*/consent.js|*/firebase-config.js|*/globe.js|*/script.js|*/tracker.js) ;;
		*) cp "$file" "$BUILD/assets/" ;;
	esac
done
cp -R "$FRONTEND/assets/images/." "$BUILD/assets/"
cp -R "$FRONTEND/data/." "$BUILD/data/"
cp -R "$FRONTEND/vendor/." "$BUILD/vendor/"
cp "$ROOT/CNAME" "$ROOT/.nojekyll" "$BUILD/"

printf 'Built GitHub Pages site in %s\n' "$BUILD"

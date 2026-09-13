# Frontend Source

This directory contains browser-delivered source only.

- `pages/`: HTML page entry points.
- `assets/css/`: stylesheets copied to the build root.
- `assets/js/`: browser scripts; shared entry scripts are copied to the build root and page-specific helpers to `build/assets/`.
- `assets/images/`: images, logos, video, and other binary media.
- `data/`: versioned browser-delivered GeoJSON.
- `vendor/`: intentionally vendored browser dependencies documented in `docs/architecture/dependency-policy.md`.
- `components/`: reserved for reusable frontend components; page markup stays in `pages/` until extracted.

Use `scripts/build.sh` to produce the deployable root-relative site. Do not place generated files here.

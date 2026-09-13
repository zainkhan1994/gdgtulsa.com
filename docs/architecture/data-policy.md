# Data Policy

The frontend's GeoJSON files live in `src/frontend/data/` because they are
versioned, browser-delivered source data for the interactive globe.

Test-only samples belong in `tests/fixtures/`. Generated deployment output is
placed in the ignored `build/data/` directory by the frontend build. No runtime
or user-generated data is committed to this repository.
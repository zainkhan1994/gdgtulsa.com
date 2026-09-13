# Backend Tests

Backend tests mirror deployable services under `src/backend/services/`.

- `services/admin/` tests the admin service.
- `services/billing-shutdown/` tests the billing safeguard.
- Add collector tests under `services/collector/` when that service gains test coverage.

Fixtures shared across test domains belong in `tests/fixtures/`, never in application source directories.

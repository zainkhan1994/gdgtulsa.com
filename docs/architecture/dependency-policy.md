# Dependency Policy

The public frontend intentionally vendors MapLibre under `src/frontend/vendor/`.
It is a pinned, offline-safe browser dependency used by the interactive globe;
the repository keeps the matching CSS, JavaScript, license, and source map
together so deployments do not depend on a CDN at runtime.

All Python dependencies are pinned or constrained in the service-local
requirements files under `src/backend/services/`. New dependencies should be
added there with a documented reason and a reproducible version.

Generated artifacts belong in `build/` and are ignored by Git. Runtime
configuration belongs in `config/`; secrets belong in Secret Manager or local
environment variables and must never be committed.
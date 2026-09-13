# Backend Services

Each child directory is an independently deployable runtime. Keep its entry point, dependencies, templates, static files, and deployment metadata together.

- `admin/`: private Flask administration service.
- `collector/`: public analytics collector.
- `billing-shutdown/`: Cloud Function billing safeguard.

Shared backend code belongs in `src/backend/app/` only when it is used by more than one service. Service-specific code must stay inside its service directory.

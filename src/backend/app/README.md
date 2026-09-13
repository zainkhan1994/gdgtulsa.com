# Shared Backend Application Space

Deployable services live under `src/backend/services/` because the collector,
admin dashboard, and billing safeguard have separate runtimes and deployment
contracts. Shared backend packages may be added here when a real cross-service
boundary exists; service-specific routes, models, config, and templates stay
with their service.
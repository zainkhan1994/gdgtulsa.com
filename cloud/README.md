# GDG Tulsa Cloud Backend

This folder contains the Google Cloud backend source for the GDG Tulsa website analytics system.

## Architecture

Visitor browser → tracker.js → Cloud Run collector → BigQuery

Billing budget → Pub/Sub → billing-shutdown function

## Google Cloud

Project: `gdg-tulsa`

Region: `us-central1`

## Collector

Location:

`cloud/collector/`

Cloud Run service:

`gdg-tulsa-collector`

The collector:

- receives page views and click events
- requires analytics consent
- filters basic bot traffic
- hashes IP addresses instead of storing raw IPs
- writes events to BigQuery
- supports `navigator.sendBeacon()` for click tracking

Service account:

`gdg-tulsa@gdg-tulsa.iam.gserviceaccount.com`

Secret Manager secret:

`ip-hash-secret`

Never commit the actual secret value.

## BigQuery

Dataset:

`gdg-tulsa.website_analytics`

Events table:

`gdg-tulsa.website_analytics.events`

## Billing Shutdown

Location:

`cloud/billing-shutdown/`

Function:

`billing-shutdown`

Pub/Sub topic:

`billing-alerts-topic`

Shutdown budget:

`GDG Tulsa $80 Shutdown Budget`

The project also has a separate `$100` monitoring budget.

The production shutdown function currently has:

`SIMULATE_DEACTIVATION = False`

This means the $80 billing safeguard is LIVE.

Do not manually send a fake $80 budget event to the production Pub/Sub topic.

## Frontend

The public site uses:

- `consent.js`
- `tracker.js`

`admin.html` is intentionally excluded from visitor analytics.

## Security

- Do not commit passwords or API tokens.
- Do not commit service-account JSON keys.
- Do not commit Secret Manager values.
- Keep service-account permissions minimal.

## Current Status

Phase 1 is deployed and production-tested.

Confirmed working:

- Cloud Run health endpoint
- consent-based analytics
- page-view tracking
- click tracking
- BigQuery storage
- anonymous visitor IDs
- session IDs
- visitor journey reconstruction
- $80 billing safety shutdown

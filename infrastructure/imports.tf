# Declarative import blocks — FIRST STAGE ONLY (six low-risk resources).
#
# WHY IMPORT BLOCKS RATHER THAN `terraform import`:
#
#   `terraform import` writes state immediately with no preview.
#   Import blocks let `terraform plan` show exactly what would be imported and
#   what — if anything — would change afterwards, while mutating nothing.
#
#   Safe sequence on this production project:
#       terraform plan     # read-only; review every line
#       terraform apply    # only once the plan reads 0 change / 0 destroy
#
# If any resource is proposed for REPLACE rather than an in-place match, stop.
#
# Deliberately NOT in this stage: APIs, Cloud Run, budgets, IAM, Eventarc,
# the billing-shutdown function, Artifact Registry, Google-managed buckets,
# default service accounts, the billing-account attachment, and DRS.

import {
  to = google_bigquery_dataset.website_analytics
  id = "projects/gdg-tulsa/datasets/website_analytics"
}

import {
  to = google_bigquery_table.events
  id = "projects/gdg-tulsa/datasets/website_analytics/tables/events"
}

import {
  to = google_pubsub_topic.billing_alerts
  id = "projects/gdg-tulsa/topics/billing-alerts-topic"
}

# Secret CONTAINER only. The value/version is never imported, read or exposed.
import {
  to = google_secret_manager_secret.ip_hash_secret
  id = "projects/gdg-tulsa/secrets/ip-hash-secret"
}

import {
  to = google_service_account.collector
  id = "projects/gdg-tulsa/serviceAccounts/gdg-tulsa@gdg-tulsa.iam.gserviceaccount.com"
}

import {
  to = google_service_account.billing_shutdown
  id = "projects/gdg-tulsa/serviceAccounts/billing-shutdown@gdg-tulsa.iam.gserviceaccount.com"
}

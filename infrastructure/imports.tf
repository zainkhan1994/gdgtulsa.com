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

# ============================================================
# STAGE 2 — IAM and budgets
#
# The six blocks above are already in state; Terraform treats them as no-ops.
# ============================================================

# --- IAM (member-level; ids are space-separated) --------------------------

import {
  to = google_project_iam_member.collector_bigquery_data_editor
  id = "gdg-tulsa roles/bigquery.dataEditor serviceAccount:gdg-tulsa@gdg-tulsa.iam.gserviceaccount.com"
}

import {
  to = google_project_iam_member.collector_bigquery_job_user
  id = "gdg-tulsa roles/bigquery.jobUser serviceAccount:gdg-tulsa@gdg-tulsa.iam.gserviceaccount.com"
}

import {
  to = google_secret_manager_secret_iam_member.collector_ip_hash_accessor
  id = "projects/gdg-tulsa/secrets/ip-hash-secret roles/secretmanager.secretAccessor serviceAccount:gdg-tulsa@gdg-tulsa.iam.gserviceaccount.com"
}

import {
  to = google_project_iam_member.billing_shutdown_project_manager
  id = "gdg-tulsa roles/billing.projectManager serviceAccount:billing-shutdown@gdg-tulsa.iam.gserviceaccount.com"
}

# --- Budgets --------------------------------------------------------------

import {
  to = google_billing_budget.shutdown_80
  id = "billingAccounts/01A239-502350-6B64D0/budgets/585494be-fb44-4209-9758-e9de7f96c155"
}

import {
  to = google_billing_budget.alert_100
  id = "billingAccounts/01A239-502350-6B64D0/budgets/fc47ec40-1049-418a-8e1a-ee7dc60f9f69"
}

# Verified on the billing account (not the project) via
# `gcloud billing accounts get-iam-policy 01A239-502350-6B64D0`.
import {
  to = google_billing_account_iam_member.billing_shutdown_admin
  id = "01A239-502350-6B64D0 roles/billing.admin serviceAccount:billing-shutdown@gdg-tulsa.iam.gserviceaccount.com"
}

# ============================================================
# STAGE 3 — Cloud Run collector and Gen2 billing-shutdown function
#
# Earlier stages are already in state; their blocks act as no-ops.
# ============================================================

import {
  to = google_cloud_run_v2_service.collector
  id = "projects/gdg-tulsa/locations/us-central1/services/gdg-tulsa-collector"
}

import {
  to = google_cloud_run_v2_service_iam_member.collector_public_invoker
  id = "projects/gdg-tulsa/locations/us-central1/services/gdg-tulsa-collector roles/run.invoker allUsers"
}

import {
  to = google_cloudfunctions2_function.billing_shutdown
  id = "projects/gdg-tulsa/locations/us-central1/functions/billing-shutdown"
}

# The function's underlying Cloud Run service, invoked by Eventarc.
import {
  to = google_cloud_run_v2_service_iam_member.billing_shutdown_invoker
  id = "projects/gdg-tulsa/locations/us-central1/services/billing-shutdown roles/run.invoker serviceAccount:billing-shutdown@gdg-tulsa.iam.gserviceaccount.com"
}

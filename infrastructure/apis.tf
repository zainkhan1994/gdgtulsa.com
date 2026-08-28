# Google APIs already enabled on the project.
#
# IMPORTANT: every one of these is ALREADY ENABLED in production. They must be
# imported, not applied — applying without importing is harmless for enabling
# (it is idempotent), but Terraform would then own them and could disable them
# on a future destroy.
#
# disable_on_destroy = false is set on every service so that removing a service
# from this file, or any accidental destroy, can never turn off an API that
# production depends on.

locals {
  enabled_services = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "logging.googleapis.com",
    "bigquery.googleapis.com",
    "billingbudgets.googleapis.com",
    "pubsub.googleapis.com",
    "cloudfunctions.googleapis.com",
    "eventarc.googleapis.com",
    "cloudbilling.googleapis.com",
    "secretmanager.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.enabled_services)

  project = var.project_id
  service = each.value

  # Never let Terraform turn an API off. Disabling an API in a live project
  # takes the dependent services down with it.
  disable_on_destroy         = false
  disable_dependent_services = false
}

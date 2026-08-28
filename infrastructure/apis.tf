# Google APIs — POSTPONED TO A LATER STAGE.
#
# All 11 services below are already enabled in production (the live project has
# 36 enabled in total; the rest are Google-managed defaults we do not intend to
# manage).
#
# The resource is commented out on purpose. If it were declared without a
# matching import block, `terraform plan` would report 11 services "to add",
# which would break the first stage's required 0-to-add result.
#
# When this stage is enabled, keep disable_on_destroy = false so Terraform can
# never switch off an API production depends on.

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

# resource "google_project_service" "enabled" {
#   for_each = toset(local.enabled_services)
#
#   project = var.project_id
#   service = each.value
#
#   disable_on_destroy         = false
#   disable_dependent_services = false
# }

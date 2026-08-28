# Service accounts.
#
# EXISTING PRODUCTION RESOURCES — import only.
#
# No keys are defined for either account. Key creation is blocked org-wide by
# constraints/iam.disableServiceAccountKeyCreation, which must stay enforced.
# Workload identity is used instead.

# Runtime identity for the Cloud Run analytics collector.
resource "google_service_account" "collector" {
  project      = var.project_id
  account_id   = "gdg-tulsa"
  display_name = "GDG Tulsa"
}

# Runtime identity for the Gen2 billing-shutdown function.
resource "google_service_account" "billing_shutdown" {
  project      = var.project_id
  account_id   = "billing-shutdown"
  display_name = "GDG Tulsa Billing Shutdown"
}

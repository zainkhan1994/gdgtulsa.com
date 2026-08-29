# IAM — purpose-built bindings only.
#
# EXISTING PRODUCTION BINDINGS — import only, never create.
#
# Member-level resources (google_*_iam_member) are used throughout, never
# _binding or _policy. Authoritative resources silently remove any member not
# enumerated here, which on this project would strip Google's service agents
# and break Cloud Build, Eventarc, Cloud Run and Pub/Sub.
#
# Deliberately NOT managed (see README):
#   - roles/owner for zain@thekhanstruct.com          (human administrator)
#   - every roles/*.serviceAgent binding              (Google-managed)
#   - roles/cloudbuild.builds.builder x2              (Google default for deploys)
#   - roles/run.invoker for allUsers on the collector (deferred to the Cloud
#     Run stage, so the service and its public-access binding move together)

# --- Collector service account -------------------------------------------

resource "google_project_iam_member" "collector_bigquery_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.collector.email}"
}

resource "google_project_iam_member" "collector_bigquery_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.collector.email}"
}

# Scoped to the single secret, not granted project-wide.
resource "google_secret_manager_secret_iam_member" "collector_ip_hash_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.ip_hash_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.collector.email}"
}

# --- Billing shutdown service account ------------------------------------

resource "google_project_iam_member" "billing_shutdown_project_manager" {
  project = var.project_id
  role    = "roles/billing.projectManager"
  member  = "serviceAccount:${google_service_account.billing_shutdown.email}"
}

# --- Billing-account level role ------------------------------------------
#
# Verified present on billing account 01A239-502350-6B64D0 via
# `gcloud billing accounts get-iam-policy`. This binding is what allows the
# shutdown function to detach billing; without it the safeguard cannot act.
#
# Non-authoritative: this manages exactly this one member and cannot remove
# any other principal on the billing account.

resource "google_billing_account_iam_member" "billing_shutdown_admin" {
  billing_account_id = var.billing_account
  role               = "roles/billing.admin"
  member             = "serviceAccount:${google_service_account.billing_shutdown.email}"
}

# Scoped access to the identity hashing secret only.
resource "google_secret_manager_secret_iam_member" "collector_identity_hash_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.identity_hash_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.collector.email}"
}

# Scoped access to the admin allowlist secret only.
resource "google_secret_manager_secret_iam_member" "collector_admin_emails_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.admin_emails.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.collector.email}"
}

# --- Private admin service account --------------------------------------

# The private admin service may read only the existing administrator
# allowlist secret.
resource "google_secret_manager_secret_iam_member" "admin_admin_emails_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.admin_emails.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin.email}"
}

# The private admin service may read only its own session-signing secret.
resource "google_secret_manager_secret_iam_member" "admin_session_secret_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.admin_session_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin.email}"
}

# --- Private admin analytics access -------------------------------------

# Allows the private admin service to execute BigQuery query jobs.
resource "google_project_iam_member" "admin_bigquery_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.admin.email}"
}

# Operational follow-up storage.
#
# Deliberately in gdg-tulsa rather than tulsahub. The admin service holds only
# roles/datastore.viewer in tulsahub and must stay unable to modify members,
# registrations, scheduleRequests, memberResources or memberEvents. Putting the
# admin's own workflow state in a separate project preserves that: the read of
# member identity and the write of follow-up state are different clients
# against different projects.
#
# This database holds nothing but followUpStatus documents keyed by an opaque
# member_ref. No name, email, phone, Firebase UID or analytics identifier.

# NOTE: apis.tf deliberately leaves already-enabled services unmanaged, to keep
# the migration's zero-to-add invariant. Firestore is genuinely new, so
# declaring it adds cleanly with no import. disable_on_destroy stays false so
# Terraform can never switch off an API production depends on.
resource "google_project_service" "firestore" {
  project = var.project_id
  service = "firestore.googleapis.com"

  disable_on_destroy         = false
  disable_dependent_services = false
}

# Location is irreversible once created. us-central1 matches the admin Cloud Run
# service and the BigQuery dataset; regional rather than multi-region because a
# four-value status field does not need cross-region durability.
resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = "us-central1"
  type        = "FIRESTORE_NATIVE"

  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"

  depends_on = [google_project_service.firestore]
}

# Least privilege for the follow-up workflow.
#
# Firestore IAM cannot be scoped to a single collection for Admin SDK access,
# so the narrowing that is available is on operations rather than data.
# datastore.entities.delete is deliberately excluded: V1 uses "dismissed" as a
# status and never deletes, so a bug or a compromised endpoint cannot destroy
# operational state.
resource "google_project_iam_custom_role" "follow_up_writer" {
  project     = var.project_id
  role_id     = "gdgTulsaFollowUpWriter"
  title       = "GDG Tulsa Follow-up Writer"
  description = "Read and write follow-up workflow state. No delete."

  permissions = [
    "datastore.databases.get",
    "datastore.entities.get",
    "datastore.entities.list",
    "datastore.entities.create",
    "datastore.entities.update",
  ]
}

# Granted to the private admin service account only. Not the collector, not a
# user, not a group.
resource "google_project_iam_member" "admin_follow_up_writer" {
  project = var.project_id
  role    = google_project_iam_custom_role.follow_up_writer.name
  member  = "serviceAccount:${google_service_account.admin.email}"
}

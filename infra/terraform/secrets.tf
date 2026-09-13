# Secret Manager.
#
# EXISTING PRODUCTION RESOURCE — import only.
#
# CRITICAL: this manages the secret CONTAINER only. The secret VALUE is never
# read, written, referenced or imported. google_secret_manager_secret_version
# must never be added here — doing so would place the IP hashing key into
# Terraform state in plaintext.

resource "google_secret_manager_secret" "ip_hash_secret" {
  project   = var.project_id
  secret_id = "ip-hash-secret"

  replication {
    auto {}
  }
}

# Dedicated key for pseudonymising verified Firebase UIDs.
#
# As with ip-hash-secret, Terraform manages only the secret container.
# The secret VALUE is created separately and never enters Terraform state.
resource "google_secret_manager_secret" "identity_hash_secret" {
  project             = var.project_id
  secret_id           = "identity-hash-secret"
  deletion_protection = true

  replication {
    auto {}
  }
}

# Server-side allowlist for analytics dashboard administrators.
#
# Terraform manages only the secret container. The actual email addresses are
# added separately so they never enter Terraform state.
resource "google_secret_manager_secret" "admin_emails" {
  project             = var.project_id
  secret_id           = "admin-emails"
  deletion_protection = true

  replication {
    auto {}
  }
}

# Signing key for the private admin application's server-side session.
#
# Terraform manages only the secret container. The secret VALUE is generated
# and added separately so it never enters Git or Terraform state.
resource "google_secret_manager_secret" "admin_session_secret" {
  project             = var.project_id
  secret_id           = "admin-session-secret"
  deletion_protection = true

  replication {
    auto {}
  }
}

# Long-lived key for the opaque follow-up member reference.
#
# Kept separate from admin-session-secret on purpose: member_ref is a Firestore
# document id, so rotating the session signing key must not orphan every
# follow-up record.
#
# Terraform manages only the secret container. The secret VALUE is generated
# separately and never enters Git or Terraform state.
resource "google_secret_manager_secret" "followup_member_ref_secret" {
  project             = var.project_id
  secret_id           = "followup-member-ref-secret"
  deletion_protection = true

  replication {
    auto {}
  }
}

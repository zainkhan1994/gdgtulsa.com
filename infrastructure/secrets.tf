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

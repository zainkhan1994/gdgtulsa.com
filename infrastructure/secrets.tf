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

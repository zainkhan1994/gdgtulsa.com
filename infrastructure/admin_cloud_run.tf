# Cloud Run — private GDG Tulsa admin application.
#
# The service is publicly reachable only so unauthenticated users can reach
# the login boundary. Dashboard access is enforced inside the application by
# verified Firebase authentication, the server-side admin allowlist, and a
# secure server session.

resource "google_cloud_run_v2_service" "admin" {
  project  = var.project_id
  name     = "gdg-tulsa-admin"
  location = var.region

  ingress = "INGRESS_TRAFFIC_ALL"

  deletion_protection = true

  template {
    service_account                  = google_service_account.admin.email
    timeout                          = "60s"
    max_instance_request_concurrency = 40

    containers {
      image = "us-central1-docker.pkg.dev/gdg-tulsa/cloud-run-source-deploy/gdg-tulsa-admin@sha256:3d5996645e2b805f0c369bf0782e31cb0816d7024d3bbb4cc2fe2a0c1de21bda"

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }

        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name = "SESSION_SECRET"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.admin_session_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "ADMIN_EMAILS"

        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.admin_emails.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  # The service was initially deployed with `gcloud run deploy --source`.
  # Preserve gcloud/source-build metadata without making Terraform own it.
  lifecycle {
    ignore_changes = [
      client,
      client_version,
      build_config,
      scaling,
    ]
  }
}

# Public access is required for the login page itself.
# Application-level authorization protects the dashboard and admin data.
resource "google_cloud_run_v2_service_iam_member" "admin_public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.admin.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

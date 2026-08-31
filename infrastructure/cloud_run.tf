# Cloud Run — analytics collector.
#
# EXISTING PRODUCTION SERVICE — import only, never create.
#
# Only user-configurable fields are declared. Everything Google generates is
# deliberately absent: build ids, operation ids, client-name/client-version
# annotations, creator/lastModifier, revision names, URLs, generation, etag
# and traffic status. The provider exposes those as computed, so omitting
# them produces no diff.
#
# Scaling note: the SERVICE metadata still carries a stale
# run.googleapis.com/maxScale = 20 from an earlier deploy, while the ACTIVE
# revision template carries autoscaling.knative.dev/maxScale = 1. The revision
# is what actually governs scaling, so max_instance_count = 1 is modelled here.
# Service-level annotations are not declared; the provider tracks Google-set
# annotations under effective_annotations, so leaving them out does not diff.

resource "google_cloud_run_v2_service" "collector" {
  project  = var.project_id
  name     = "gdg-tulsa-collector"
  location = var.region

  ingress = "INGRESS_TRAFFIC_ALL"

  # Terraform-side guard only; not sent to the API, so it cannot diff.
  deletion_protection = true

  template {
    service_account                  = google_service_account.collector.email
    timeout                          = "300s"
    max_instance_request_concurrency = 80

    scaling {
      # Matches the live revision, not the stale service-level annotation.
      max_instance_count = 1
      min_instance_count = 0
    }

    containers {
      image = "us-central1-docker.pkg.dev/gdg-tulsa/cloud-run-source-deploy/gdg-tulsa-collector@sha256:04b85bafbe84c331d407afb74fd51b1433ff9c586fb34775f25be2719a483fcb"

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        # Both are real runtime settings and stay actively managed.
        # cpu_idle = true means CPU is allocated only during requests, which
        # is what makes this service cost nothing while idle.
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # Injected from Secret Manager at runtime. The VALUE is never read by
      # Terraform — only the reference to the secret and version alias.
      env {
        name = "IP_HASH_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ip_hash_secret.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "IDENTITY_HASH_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.identity_hash_secret.secret_id
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

  # Four fields exist in live state only because this service was originally
  # created by `gcloud run deploy --source`. All four are optional and NOT
  # computed in provider 6.50.0, so leaving them undeclared makes Terraform
  # propose deleting them. Each is preserved rather than owned:
  #
  #   client, client_version
  #     Arbitrary deploy-tool identifiers ("gcloud", "581.0.0"). Declaring
  #     them would assert Terraform deployed via gcloud, and every future
  #     gcloud version bump would then show as drift forever.
  #
  #   build_config
  #     Describes the source-build pipeline: base_image, image_uri,
  #     source_location and the build id. Terraform must not own this — taking
  #     it over risks triggering builds and couples infrastructure to the
  #     application deploy path we deliberately left with gcloud/CI.
  #
  #   scaling (SERVICE level)
  #     manual_instance_count / min_instance_count / scaling_mode. Declaring
  #     these could switch the service between automatic and manual scaling.
  #     This is NOT template.scaling — the revision-level
  #     max_instance_count = 1 above remains actively managed.
  #
  # Everything that governs runtime behaviour stays managed: image, service
  # account, secret env var, memory, CPU limit, cpu_idle, startup_cpu_boost,
  # concurrency, timeout, template max_instance_count, ingress and traffic.
  lifecycle {
    ignore_changes = [
      client,
      client_version,
      build_config,
      scaling,
    ]
  }
}

# The binding that makes the collector publicly reachable. Non-authoritative:
# it manages this one member and cannot remove any other principal.
resource "google_cloud_run_v2_service_iam_member" "collector_public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.collector.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

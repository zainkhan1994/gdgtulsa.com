# Cloud Functions Gen2 — billing shutdown.
#
# EXISTING PRODUCTION FUNCTION — import only, never create.
#
# HIGH RISK: this function detaches the project's billing account when the
# $80 budget is reached. cloud/billing-shutdown/main.py has
# SIMULATE_DEACTIVATION = False, so it is armed. Any plan proposing to update
# or replace this resource must be understood before it is applied — a
# redeploy briefly leaves the safeguard unavailable.
#
# The Eventarc trigger and its Pub/Sub subscription are created and owned by
# Cloud Functions. They are represented ONLY through event_trigger below;
# the generated trigger name is exposed as the computed `trigger` attribute
# and is not managed as a separate resource.

resource "google_cloudfunctions2_function" "billing_shutdown" {
  project  = var.project_id
  name     = "billing-shutdown"
  location = var.region

  build_config {
    runtime     = "python312"
    entry_point = "stop_billing"

    # Google-managed repository for Gen2 build artifacts. Referenced, not managed.
    docker_repository = "projects/${var.project_id}/locations/${var.region}/repositories/gcf-artifacts"

    # Build (not runtime) identity, as reported by the live function.
    service_account = "projects/${var.project_id}/serviceAccounts/${var.project_number}-compute@developer.gserviceaccount.com"

    source {
      storage_source {
        bucket = "gcf-v2-sources-${var.project_number}-${var.region}"
        object = "billing-shutdown/function-source.zip"

        # Pinning the generation keeps Terraform matched to the artifact that
        # is actually deployed. If the function is redeployed out of band this
        # value changes and the plan will show it — which is the intended
        # signal, not drift to hide.
        generation = 1788594248444304
      }
    }
  }

  service_config {
    available_memory                 = "256Mi"
    available_cpu                    = "0.1666"
    timeout_seconds                  = 60
    max_instance_count               = 1
    max_instance_request_concurrency = 1
    ingress_settings                 = "ALLOW_ALL"
    all_traffic_on_latest_revision   = true
    service_account_email            = google_service_account.billing_shutdown.email

    # Declared deliberately. environment_variables is optional but NOT computed
    # in provider 6.50.0, so omitting it would make Terraform treat the live
    # LOG_EXECUTION_ID as unwanted and propose removing it — which would
    # redeploy the armed shutdown function. Declaring it matches live exactly.
    #
    # The four values below are what the function trusts instead of the
    # incoming message. Each is read from the resource it describes, so the
    # budget id and amount cannot drift away from the budget Terraform manages,
    # and no identifier is typed out a second time. The function fails closed
    # if any of them is missing.
    environment_variables = {
      LOG_EXECUTION_ID            = "true"
      TARGET_PROJECT_ID           = var.project_id
      SHUTDOWN_BUDGET_ID          = google_billing_budget.shutdown_80.name
      EXPECTED_BILLING_ACCOUNT_ID = var.billing_account
      EXPECTED_BUDGET_UNITS       = google_billing_budget.shutdown_80.amount[0].specified_amount[0].units
    }
  }

  event_trigger {
    trigger_region = var.region
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.billing_alerts.id
    # A failed shutdown is the one event that must not be dropped. Redelivery
    # is safe because the unlink is a set-to-state operation and the function
    # checks live billing state first, so a duplicate is a logged no-op.
    # Only genuinely transient failures on the threshold path raise; malformed
    # input and configuration errors acknowledge, so nothing retries for 24h
    # that retrying could never fix.
    retry_policy          = "RETRY_POLICY_RETRY"
    service_account_email = google_service_account.billing_shutdown.email
  }
}

# Eventarc invokes the function through its underlying Cloud Run service.
# That service is owned by Cloud Functions and is NOT declared as a
# google_cloud_run_v2_service here; only this one IAM member is managed.
resource "google_cloud_run_v2_service_iam_member" "billing_shutdown_invoker" {
  project  = var.project_id
  location = var.region
  name     = "billing-shutdown"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.billing_shutdown.email}"
}

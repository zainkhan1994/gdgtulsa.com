# Operational monitoring.
#
# Six alert policies, deliberately few. Thresholds are set from measured
# production behaviour rather than defaults: over seven days the collector
# served 94 requests and the admin 555, with ZERO 5xx on either. 4xx, by
# contrast, is 22% of collector traffic and 52% of admin traffic - rejected
# malformed posts and unauthenticated 401 probes - so 4xx is never alerted on.
#
# No application source changes: every log filter below keys on markers the
# services already emit, all of which are free of member data.

resource "google_monitoring_notification_channel" "operations" {
  project      = var.project_id
  display_name = "GDG Tulsa Operations"
  type         = "email"

  labels = {
    email_address = var.monitoring_notification_email
  }
}

# --- Uptime checks -------------------------------------------------------
#
# Only the public /health endpoints. The private API routes deliberately answer
# 401 without a session, so probing them would either mask a real outage or
# manufacture a false one.
#
# 10s timeout is chosen against a measured cold start: with
# min_instance_count = 0 and cpu_idle = true, the first request after an idle
# period took 4.6s while warm requests took ~0.3s. A 5s timeout would page on
# the first check after any quiet hour.
#
# 5-minute period, not 1: at this traffic level a 1-minute probe would keep an
# instance permanently warm and change the services' billing profile.

resource "google_monitoring_uptime_check_config" "collector_health" {
  project      = var.project_id
  display_name = "Collector health"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true

    accepted_response_status_codes {
      status_value = 200
    }
  }

  monitored_resource {
    type = "uptime_url"

    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.collector.uri, "https://")
    }
  }

  selected_regions = ["USA_OREGON", "USA_IOWA", "USA_VIRGINIA", "EUROPE"]
}

resource "google_monitoring_uptime_check_config" "admin_health" {
  project      = var.project_id
  display_name = "Admin health"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true

    accepted_response_status_codes {
      status_value = 200
    }
  }

  monitored_resource {
    type = "uptime_url"

    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.admin.uri, "https://")
    }
  }

  selected_regions = ["USA_OREGON", "USA_IOWA", "USA_VIRGINIA", "EUROPE"]
}

# --- Log-based metrics ---------------------------------------------------

# Serious failures: data was lost, a write path is broken, or a secret is
# missing so a feature is silently dead. One occurrence is worth knowing about.
resource "google_logging_metric" "data_path_errors" {
  project = var.project_id
  name    = "gdg_tulsa_data_path_errors"

  description = "Collector/admin failures that mean lost data or broken configuration."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    AND resource.labels.service_name=("gdg-tulsa-collector" OR "gdg-tulsa-admin")
    AND (
      textPayload:"BigQuery insert errors"
      OR textPayload:"Identity link storage failure"
      OR textPayload:"Verified member analytics storage failure"
      OR textPayload:"journeys identity secret unavailable"
      OR textPayload:"follow-up reference secret unavailable"
      OR textPayload:"follow-up status write failure"
    )
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# Read-side failures. A single one is usually a transient BigQuery or Firestore
# hiccup and is logged but not alerted; a run of them is not.
resource "google_logging_metric" "query_errors" {
  project = var.project_id
  name    = "gdg_tulsa_query_errors"

  description = "Repeated admin read/query failures."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    AND resource.labels.service_name="gdg-tulsa-admin"
    AND (
      textPayload:"Private admin analytics query failure"
      OR textPayload:"Private admin community query failure"
      OR textPayload:"Private admin journeys query failure"
      OR textPayload:"Private admin follow-up status read failure"
    )
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# A deployment can fail while the previous healthy revision keeps serving, so
# uptime alone would never reveal it. Scoped to this project's two services so
# unrelated audit errors cannot trigger it.
resource "google_logging_metric" "deployment_failures" {
  project = var.project_id
  name    = "gdg_tulsa_deployment_failures"

  description = "Failed Cloud Run revision or service update."

  filter = <<-EOT
    logName="projects/${var.project_id}/logs/cloudaudit.googleapis.com%2Fsystem_event"
    AND resource.type="cloud_run_revision"
    AND resource.labels.service_name=("gdg-tulsa-collector" OR "gdg-tulsa-admin")
    AND protoPayload.methodName="/Services.UpdateService"
    AND severity>=ERROR
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# Errors only. The function records ~100 successful infrastructure/startup
# requests a day, so alerting on invocations would be permanent noise.
resource "google_logging_metric" "billing_shutdown_errors" {
  project = var.project_id
  name    = "gdg_tulsa_billing_shutdown_errors"

  description = "Billing shutdown function errors."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    AND resource.labels.service_name="billing-shutdown"
    AND severity>=ERROR
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# --- Alert policies ------------------------------------------------------

resource "google_monitoring_alert_policy" "collector_unavailable" {
  project      = var.project_id
  display_name = "Collector unavailable"
  combiner     = "OR"

  documentation {
    content   = "The collector /health endpoint is failing from multiple regions. Analytics ingestion is likely down."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Collector /health failing in 2+ regions"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "resource.type=\"uptime_url\"",
        "metric.label.check_id=\"${google_monitoring_uptime_check_config.collector_health.uptime_check_id}\"",
      ])

      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period = "300s"
        # ALIGN_NEXT_OLDER keeps each region's check_passed boolean intact;
        # REDUCE_COUNT_FALSE then counts how many regions are failing. Aligning
        # with COUNT_FALSE first would yield a number per series and the reducer
        # would be counting the wrong thing.
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = [google_monitoring_notification_channel.operations.id]
}

resource "google_monitoring_alert_policy" "admin_unavailable" {
  project      = var.project_id
  display_name = "Admin unavailable"
  combiner     = "OR"

  documentation {
    content   = "The private admin /health endpoint is failing from multiple regions."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Admin /health failing in 2+ regions"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "resource.type=\"uptime_url\"",
        "metric.label.check_id=\"${google_monitoring_uptime_check_config.admin_health.uptime_check_id}\"",
      ])

      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period = "300s"
        # ALIGN_NEXT_OLDER keeps each region's check_passed boolean intact;
        # REDUCE_COUNT_FALSE then counts how many regions are failing. Aligning
        # with COUNT_FALSE first would yield a number per series and the reducer
        # would be counting the wrong thing.
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = [google_monitoring_notification_channel.operations.id]
}

# Baseline is zero 5xx across seven days, so 3 in five minutes is well clear of
# normal. 4xx is excluded entirely: it is the majority of admin traffic.
resource "google_monitoring_alert_policy" "cloud_run_server_errors" {
  project      = var.project_id
  display_name = "Cloud Run sustained 5xx"
  combiner     = "OR"

  documentation {
    content   = "A GDG Tulsa Cloud Run service is returning server errors. 4xx is deliberately excluded - it is normal traffic here."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "More than 3 5xx responses in 5 minutes"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.service_name=one_of(\"gdg-tulsa-collector\",\"gdg-tulsa-admin\")",
        "metric.label.response_code_class=\"5xx\"",
      ])

      comparison      = "COMPARISON_GT"
      threshold_value = 3
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = [google_monitoring_notification_channel.operations.id]
}

# Immediate: the shutdown path has no retry and no dead-letter, so a failed
# invocation can mean the $80 billing shutdown simply does not happen.
resource "google_monitoring_alert_policy" "billing_shutdown_failure" {
  project      = var.project_id
  display_name = "Budget shutdown failure"
  combiner     = "OR"

  documentation {
    content   = "The billing shutdown function logged an error. It is configured without retry or dead-lettering, so the $80 shutdown may not have executed."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Billing shutdown function error"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"logging.googleapis.com/user/${google_logging_metric.billing_shutdown_errors.name}\"",
        "resource.type=\"cloud_run_revision\"",
      ])

      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_DELTA"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.operations.id]
}

# One policy, two conditions, different thresholds: lost data is worth one
# occurrence, a transient read failure is not.
resource "google_monitoring_alert_policy" "application_errors" {
  project      = var.project_id
  display_name = "Application and data-path errors"
  combiner     = "OR"

  documentation {
    content   = "A GDG Tulsa service reported a data-path or repeated query failure. Check Cloud Logging for the specific marker."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Data-path error (lost data or broken configuration)"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"logging.googleapis.com/user/${google_logging_metric.data_path_errors.name}\"",
        "resource.type=\"cloud_run_revision\"",
      ])

      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_DELTA"
      }

      trigger {
        count = 1
      }
    }
  }

  conditions {
    display_name = "Repeated read/query failures"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"logging.googleapis.com/user/${google_logging_metric.query_errors.name}\"",
        "resource.type=\"cloud_run_revision\"",
      ])

      # The Monitoring API accepts only COMPARISON_LT and COMPARISON_GT,
      # so ">= 3 occurrences" is expressed as "> 2". Identical for an
      # integer count metric.
      comparison      = "COMPARISON_GT"
      threshold_value = 2
      duration        = "0s"

      aggregations {
        alignment_period   = "600s"
        per_series_aligner = "ALIGN_DELTA"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  notification_channels = [google_monitoring_notification_channel.operations.id]
}

resource "google_monitoring_alert_policy" "deployment_failure" {
  project      = var.project_id
  display_name = "Cloud Run deployment failure"
  combiner     = "OR"

  documentation {
    content   = "A Cloud Run revision failed to deploy. The previous healthy revision may still be serving, so this is separate from an outage."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Failed revision or service update"

    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"logging.googleapis.com/user/${google_logging_metric.deployment_failures.name}\"",
        "resource.type=\"cloud_run_revision\"",
      ])

      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_DELTA"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "3600s"
  }

  notification_channels = [google_monitoring_notification_channel.operations.id]
}

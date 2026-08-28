# Cloud Billing budgets.
#
# EXISTING PRODUCTION RESOURCES — import only.
#
# Budget #1 drives the live billing-shutdown function. Its notification rule
# must not be altered: changing the Pub/Sub topic or thresholds would either
# disarm the safeguard or fire it.
#
# The third budget in this billing account, "$100 Monthly Budget Alert", is
# billing-account-wide, has no Pub/Sub rule, predates this project and is
# intentionally left unmanaged.

# Fires the billing-shutdown function at $80 of gross (pre-credit) spend.
resource "google_billing_budget" "shutdown_80" {
  billing_account = var.billing_account
  display_name    = "GDG Tulsa $80 Shutdown Budget"

  budget_filter {
    projects               = ["projects/${var.project_number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "80"
    }
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.billing_alerts.id
    schema_version = "1.0"
  }
}

# Warning-only budget. Publishes to the same topic; the shutdown function
# ignores it by matching on budgetDisplayName.
resource "google_billing_budget" "alert_100" {
  billing_account = var.billing_account
  display_name    = "GDG Tulsa $100 Budget"

  budget_filter {
    projects               = ["projects/${var.project_number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "100"
    }
  }

  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.8
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.billing_alerts.id
    schema_version = "1.0"
  }
}

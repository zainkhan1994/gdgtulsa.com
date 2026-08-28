# Pub/Sub topic carrying Cloud Billing budget notifications.
#
# EXISTING PRODUCTION RESOURCE — import only.
#
# The Eventarc push subscription that feeds the billing-shutdown function
# (eventarc-us-central1-billing-shutdown-997704-sub-682) is created and owned
# by Eventarc. It is deliberately NOT managed here — see README.

resource "google_pubsub_topic" "billing_alerts" {
  project = var.project_id
  name    = "billing-alerts-topic"
}

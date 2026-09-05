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

# Independent, retained copy of every budget notification.
#
# Pub/Sub fans out, so this sits BESIDE the Eventarc delivery, never in front
# of it: the budget service publishes once and both subscriptions receive it.
# Nothing consumes this one. It exists so that if a shutdown notification is
# ever lost downstream, the original message is still inspectable for a week.
#
# RECOVERY IS DELIBERATELY MANUAL. Do not republish a retained message to
# billing-alerts-topic — that topic is reserved for the Cloud Billing budget
# service, and a replayed message would be trusted like a real one. Safe
# recovery is: identify the failed event, confirm the budget id and project,
# check live spend and budget configuration in the Cloud Console, check the
# current billing state, and only then have an operator decide and act. There
# is intentionally no one-command replay.
resource "google_pubsub_subscription" "billing_alerts_audit" {
  project = var.project_id
  name    = "billing-alerts-audit"
  topic   = google_pubsub_topic.billing_alerts.id

  # Seven days of evidence. No push endpoint and no subscriber, so messages
  # simply accumulate and age out.
  message_retention_duration = "604800s"
  retain_acked_messages      = false

  # Nothing pulls from this subscription, and an unpulled subscription is
  # otherwise deleted after 31 days of inactivity. An empty ttl disables that.
  expiration_policy {
    ttl = ""
  }
}

# BigQuery analytics storage.
#
# EXISTING PRODUCTION RESOURCES — import only, never create.
# Values below are transcribed from the live inventory, not from the handoff
# document, so that `terraform plan` reports no changes after import.

resource "google_bigquery_dataset" "website_analytics" {
  project     = var.project_id
  dataset_id  = "website_analytics"
  description = "GDG Tulsa website analytics"
  location    = "US"

  # 168h is the BigQuery default; stated explicitly so a provider default
  # change can never silently alter time-travel on a production dataset.
  max_time_travel_hours = 168

  # These four entries are the live ACL. They must be declared, otherwise
  # Terraform treats the dataset as having no access blocks and proposes
  # removing them.
  access {
    role          = "OWNER"
    special_group = "projectOwners"
  }
  access {
    role          = "WRITER"
    special_group = "projectWriters"
  }
  access {
    role          = "READER"
    special_group = "projectReaders"
  }
  access {
    role          = "OWNER"
    user_by_email = "zain@thekhanstruct.com"
  }

  # Refuse to delete a dataset that still holds tables.
  delete_contents_on_destroy = false
}

resource "google_bigquery_table" "events" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.website_analytics.dataset_id
  table_id   = "events"

  # Blocks `terraform destroy` on this table. Leave enabled.
  deletion_protection = true

  time_partitioning {
    type  = "DAY"
    field = "event_timestamp"
  }

  clustering = ["event_name", "session_id"]

  schema = jsonencode([
    { name = "event_id", type = "STRING" },
    { name = "event_timestamp", type = "TIMESTAMP" },
    { name = "anonymous_id", type = "STRING" },
    { name = "session_id", type = "STRING" },
    { name = "event_name", type = "STRING" },
    { name = "page_url", type = "STRING" },
    { name = "page_path", type = "STRING" },
    { name = "page_title", type = "STRING" },
    { name = "referrer", type = "STRING" },
    { name = "utm_source", type = "STRING" },
    { name = "utm_medium", type = "STRING" },
    { name = "utm_campaign", type = "STRING" },
    { name = "click_text", type = "STRING" },
    { name = "click_url", type = "STRING" },
    { name = "user_agent", type = "STRING" },
    { name = "ip_hash", type = "STRING" },
  ])
}

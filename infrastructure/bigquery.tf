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

# Identity stitching.
#
# Links an analytics browser identity to a verified Firebase identity.
# No email, name, raw Firebase UID or Firebase token is stored here.
resource "google_bigquery_table" "identity_links" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.website_analytics.dataset_id
  table_id   = "identity_links"

  deletion_protection = true

  time_partitioning {
    type  = "DAY"
    field = "linked_at"
  }

  clustering = ["firebase_uid_hash", "anonymous_id"]

  schema = jsonencode([
    { name = "link_id", type = "STRING", mode = "REQUIRED" },
    { name = "linked_at", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "anonymous_id", type = "STRING", mode = "REQUIRED" },
    { name = "session_id", type = "STRING", mode = "REQUIRED" },
    { name = "firebase_uid_hash", type = "STRING", mode = "REQUIRED" },
  ])
}

# Reporting view: one row per anonymous visitor.
#
# Conversion fields are booleans so repeated clicks by one visitor do not
# inflate conversion counts. Verified membership is derived only from the
# pseudonymous identity_links table.
resource "google_bigquery_table" "visitor_journeys" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.website_analytics.dataset_id
  table_id   = "visitor_journeys"

  deletion_protection = true

  view {
    use_legacy_sql = false

    query = <<-SQL
      WITH event_rollup AS (
        SELECT
          anonymous_id,
          MIN(event_timestamp) AS first_seen,
          MAX(event_timestamp) AS last_seen,
          COUNTIF(event_name = 'page_view') AS page_views,
          COUNTIF(event_name = 'click') AS clicks,
          COUNTIF(event_name = 'speaker_interest') > 0 AS speaker_interest,
          COUNTIF(event_name = 'partner_interest') > 0 AS partner_interest,
          COUNTIF(event_name = 'member_register_open') > 0 AS registration_started,
          COUNTIF(event_name = 'schedule_open') > 0 AS schedule_opened,
          COUNTIF(event_name = 'schedule_submit') > 0 AS schedule_submitted
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.events`
        GROUP BY anonymous_id
      ),
      verified_visitors AS (
        SELECT DISTINCT anonymous_id
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.identity_links`
      )
      SELECT
        events.anonymous_id,
        events.first_seen,
        events.last_seen,
        events.page_views,
        events.clicks,
        events.speaker_interest,
        events.partner_interest,
        events.registration_started,
        events.schedule_opened,
        events.schedule_submitted,
        verified.anonymous_id IS NOT NULL AS verified_member
      FROM event_rollup AS events
      LEFT JOIN verified_visitors AS verified
        USING (anonymous_id)
    SQL
  }
}

# Reporting view: visitor-level conversion funnel.
#
# Each stage counts unique visitor journeys that reached that state.
# Repeated clicks/events by the same anonymous visitor count only once.
resource "google_bigquery_table" "conversion_funnel" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.website_analytics.dataset_id
  table_id   = "conversion_funnel"

  deletion_protection = true

  view {
    use_legacy_sql = false

    query = <<-SQL
      WITH totals AS (
        SELECT
          COUNT(*) AS total_visitors,
          COUNTIF(registration_started) AS registration_started,
          COUNTIF(verified_member) AS verified_members,
          COUNTIF(schedule_opened) AS schedule_opened,
          COUNTIF(schedule_submitted) AS schedule_submitted
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.visitor_journeys`
      )
      SELECT
        1 AS stage_order,
        'Visitors' AS stage,
        total_visitors AS visitors,
        1.0 AS percent_of_visitors
      FROM totals

      UNION ALL

      SELECT
        2,
        'Registration started',
        registration_started,
        SAFE_DIVIDE(registration_started, total_visitors)
      FROM totals

      UNION ALL

      SELECT
        3,
        'Verified members',
        verified_members,
        SAFE_DIVIDE(verified_members, total_visitors)
      FROM totals

      UNION ALL

      SELECT
        4,
        'Scheduler opened',
        schedule_opened,
        SAFE_DIVIDE(schedule_opened, total_visitors)
      FROM totals

      UNION ALL

      SELECT
        5,
        'Schedule submitted',
        schedule_submitted,
        SAFE_DIVIDE(schedule_submitted, total_visitors)
      FROM totals
    SQL
  }
}

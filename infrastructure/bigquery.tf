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

  # Private admin dashboard has read-only access to analytics.
  access {
    role          = "READER"
    user_by_email = google_service_account.admin.email
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
    { name = "is_admin", type = "BOOLEAN", mode = "NULLABLE" },
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
      WITH admin_visitors AS (
        SELECT DISTINCT anonymous_id
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.identity_links`
        WHERE is_admin IS TRUE
      ),
      event_rollup AS (
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
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.events` AS event
        WHERE NOT EXISTS (
          SELECT 1
          FROM admin_visitors AS admin
          WHERE admin.anonymous_id = event.anonymous_id
        )
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

# Reporting view: strict sequential conversion funnel (all time).
#
# Each stage counts unique visitors who reached that stage AFTER the previous
# one. Sequencing is done here against raw events rather than against
# visitor_journeys, whose boolean flags cannot express ordering — that is what
# allowed impossible funnels such as "scheduler opened" without registration.
#
# visitor_journeys is deliberately left unchanged: it is a general
# visitor-level rollup and altering its schema would be a larger, riskier
# change than this view requires.
#
# Verified membership comes from the trusted server-only member_verified event.
# identity_links.linked_at is NOT used: it records when the link row was
# written, and historical rows show schedule events predating it.
resource "google_bigquery_table" "conversion_funnel" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.website_analytics.dataset_id
  table_id   = "conversion_funnel"

  deletion_protection = true

  view {
    use_legacy_sql = false

    query = <<-SQL
      WITH admin_visitors AS (
        SELECT DISTINCT anonymous_id
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.identity_links`
        WHERE is_admin IS TRUE
      ),
      filtered_events AS (
        SELECT
          event.anonymous_id,
          event.event_name,
          event.event_timestamp
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.events` AS event
        WHERE event.anonymous_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM admin_visitors AS admin
            WHERE admin.anonymous_id = event.anonymous_id
          )
      ),
      visitors AS (
        SELECT anonymous_id, MIN(event_timestamp) AS visitor_at
        FROM filtered_events
        GROUP BY anonymous_id
      ),
      registration AS (
        SELECT visitor.anonymous_id, MIN(event.event_timestamp) AS registration_at
        FROM visitors AS visitor
        JOIN filtered_events AS event ON event.anonymous_id = visitor.anonymous_id
        WHERE event.event_name = 'member_register_open'
          AND event.event_timestamp >= visitor.visitor_at
        GROUP BY visitor.anonymous_id
      ),
      verified AS (
        SELECT registered.anonymous_id, MIN(event.event_timestamp) AS verified_at
        FROM registration AS registered
        JOIN filtered_events AS event ON event.anonymous_id = registered.anonymous_id
        WHERE event.event_name = 'member_verified'
          AND event.event_timestamp >= registered.registration_at
        GROUP BY registered.anonymous_id
      ),
      scheduler AS (
        SELECT member.anonymous_id, MIN(event.event_timestamp) AS scheduler_at
        FROM verified AS member
        JOIN filtered_events AS event ON event.anonymous_id = member.anonymous_id
        WHERE event.event_name = 'schedule_open'
          AND event.event_timestamp >= member.verified_at
        GROUP BY member.anonymous_id
      ),
      submitted AS (
        SELECT opened.anonymous_id, MIN(event.event_timestamp) AS schedule_submitted_at
        FROM scheduler AS opened
        JOIN filtered_events AS event ON event.anonymous_id = opened.anonymous_id
        WHERE event.event_name = 'schedule_submit'
          AND event.event_timestamp >= opened.scheduler_at
        GROUP BY opened.anonymous_id
      ),
      totals AS (
        SELECT
          (SELECT COUNT(*) FROM visitors) AS total_visitors,
          (SELECT COUNT(*) FROM registration) AS registration_started,
          (SELECT COUNT(*) FROM verified) AS verified_members,
          (SELECT COUNT(*) FROM scheduler) AS schedule_opened,
          (SELECT COUNT(*) FROM submitted) AS schedule_submitted
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

# Reporting view: traffic performance by page.
resource "google_bigquery_table" "page_traffic" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.website_analytics.dataset_id
  table_id   = "page_traffic"

  deletion_protection = true

  view {
    use_legacy_sql = false

    query = <<-SQL
      WITH admin_visitors AS (
        SELECT DISTINCT anonymous_id
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.identity_links`
        WHERE is_admin IS TRUE
      ),
      normalized_page_views AS (
        SELECT
          CASE
            WHEN page_path IN ('/', '/index.html') THEN '/'
            ELSE page_path
          END AS page_path,
          anonymous_id,
          session_id,
          event_timestamp
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.events` AS event
        WHERE event_name = 'page_view'
          AND NOT EXISTS (
            SELECT 1
            FROM admin_visitors AS admin
            WHERE admin.anonymous_id = event.anonymous_id
          )
      )
      SELECT
        page_path,
        COUNT(*) AS page_views,
        COUNT(DISTINCT anonymous_id) AS unique_visitors,
        COUNT(DISTINCT session_id) AS sessions,
        SAFE_DIVIDE(
          COUNT(*),
          COUNT(DISTINCT anonymous_id)
        ) AS page_views_per_visitor,
        MIN(event_timestamp) AS first_seen,
        MAX(event_timestamp) AS last_seen
      FROM normalized_page_views
      GROUP BY page_path
    SQL
  }
}

# Reporting view: session-level traffic sources.
#
# Uses only the first page view in each session so internal navigation does not
# become a new acquisition source. Authentication and internal traffic remain
# visible but can be excluded from acquisition metrics.
resource "google_bigquery_table" "traffic_sources" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.website_analytics.dataset_id
  table_id   = "traffic_sources"

  deletion_protection = true

  view {
    use_legacy_sql = false

    query = <<-SQL
      WITH admin_visitors AS (
        SELECT DISTINCT anonymous_id
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.identity_links`
        WHERE is_admin IS TRUE
      ),
      landing_pages AS (
        SELECT
          session_id,
          anonymous_id,
          page_path AS landing_page,
          referrer,
          NULLIF(utm_source, '') AS utm_source,
          NULLIF(utm_medium, '') AS utm_medium,
          NULLIF(utm_campaign, '') AS utm_campaign,
          ROW_NUMBER() OVER (
            PARTITION BY session_id
            ORDER BY event_timestamp, event_id
          ) AS row_num
        FROM `${var.project_id}.${google_bigquery_dataset.website_analytics.dataset_id}.events` AS event
        WHERE event_name = 'page_view'
          AND NOT EXISTS (
            SELECT 1
            FROM admin_visitors AS admin
            WHERE admin.anonymous_id = event.anonymous_id
          )
      ),
      classified AS (
        SELECT
          session_id,
          anonymous_id,
          landing_page,
          CASE
            WHEN utm_source IS NOT NULL THEN 'utm'
            WHEN referrer IS NULL OR referrer = '' THEN 'direct'
            WHEN REGEXP_CONTAINS(
              referrer,
              r'^https://tulsahub\.firebaseapp\.com'
            ) THEN 'authentication'
            WHEN REGEXP_CONTAINS(
              referrer,
              r'^https://(www\.)?gdgtulsa\.com'
            ) THEN 'internal'
            ELSE 'referral'
          END AS source_type,
          CASE
            WHEN utm_source IS NOT NULL THEN utm_source
            WHEN referrer IS NULL OR referrer = '' THEN '(direct / unknown)'
            WHEN REGEXP_CONTAINS(
              referrer,
              r'^https://tulsahub\.firebaseapp\.com'
            ) THEN 'tulsahub.firebaseapp.com'
            WHEN REGEXP_CONTAINS(
              referrer,
              r'^https://(www\.)?gdgtulsa\.com'
            ) THEN 'gdgtulsa.com'
            ELSE COALESCE(NET.HOST(referrer), referrer)
          END AS source,
          utm_medium,
          utm_campaign
        FROM landing_pages
        WHERE row_num = 1
      )
      SELECT
        source_type,
        source,
        utm_medium,
        utm_campaign,
        COUNT(*) AS sessions,
        COUNT(DISTINCT anonymous_id) AS unique_visitors
      FROM classified
      GROUP BY
        source_type,
        source,
        utm_medium,
        utm_campaign
    SQL
  }
}

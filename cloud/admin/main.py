import hashlib
import hmac
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import firestore
from google.cloud import bigquery
from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

FIREBASE_PROJECT_ID = "tulsahub"
PROJECT_ID = "gdg-tulsa"
DATASET_ID = "website_analytics"
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")

app = Flask(__name__)

# Keep the service bootable before its secret is provisioned, but fail closed
# for authentication until SESSION_SECRET is actually configured.
app.secret_key = SESSION_SECRET or os.urandom(32)

app.config.update(
    SESSION_COOKIE_NAME="gdg_tulsa_admin",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_PATH="/",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=1),
    SESSION_REFRESH_EACH_REQUEST=False,
)

firebase_app = firebase_admin.initialize_app(
    options={"projectId": FIREBASE_PROJECT_ID}
)

# Operational follow-up state lives in gdg-tulsa, not tulsahub. Kept as a
# separate named app so a member read can never accidentally become a member
# write: the admin holds only datastore.viewer in tulsahub.
followup_app = firebase_admin.initialize_app(
    options={"projectId": PROJECT_ID},
    name="followup",
)

bq = bigquery.Client(project=PROJECT_ID)


def same_origin_request():
    origin = request.headers.get("Origin", "")

    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False

    return (
        parsed.scheme == "https"
        and parsed.netloc == request.host
    )


def admin_email_allowlist():
    raw = os.environ.get("ADMIN_EMAILS", "")
    return {
        email.strip().lower()
        for email in raw.split(",")
        if email.strip()
    }


def admin_session_hash(email):
    if not SESSION_SECRET:
        return None

    normalized = str(email or "").strip().lower()

    if not normalized:
        return None

    return hmac.new(
        SESSION_SECRET.encode(),
        f"gdg-admin-session:{normalized}".encode(),
        hashlib.sha256,
    ).hexdigest()


def valid_admin_session():
    if not SESSION_SECRET:
        return False

    current = session.get("admin_hash")

    if not isinstance(current, str) or not current:
        return False

    allowed_hashes = {
        admin_session_hash(email)
        for email in admin_email_allowlist()
    }

    if current not in allowed_hashes:
        session.clear()
        return False

    return True


@app.after_request
def security_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=()"
    )

    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "base-uri 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'none'; "
        "script-src 'self' https://www.gstatic.com https://apis.google.com; "
        "style-src 'self'; "
        "img-src 'self' data:; "
        "connect-src 'self' "
        "https://www.gstatic.com "
        "https://identitytoolkit.googleapis.com "
        "https://securetoken.googleapis.com "
        "https://www.googleapis.com; "
        "frame-src "
        "https://accounts.google.com "
        "https://tulsahub.firebaseapp.com; "
        "form-action 'self'; "
        "upgrade-insecure-requests"
    )

    return response


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


@app.route("/login", methods=["GET"])
def login():
    if valid_admin_session():
        return redirect(url_for("dashboard"), code=303)

    return render_template("login.html")


@app.route("/session", methods=["POST"])
def create_session():
    if not same_origin_request():
        return jsonify({"error": "origin not allowed"}), 403

    if not SESSION_SECRET:
        return jsonify({"error": "admin service unavailable"}), 503

    if request.content_length and request.content_length > 16_000:
        return jsonify({"error": "payload too large"}), 413

    if not request.is_json:
        return jsonify({"error": "invalid payload"}), 400

    payload = request.get_json(silent=True) or {}
    token = payload.get("id_token")

    if not isinstance(token, str) or not token:
        return jsonify({"error": "authentication required"}), 401

    try:
        decoded = firebase_auth.verify_id_token(
            token,
            app=firebase_app,
        )
    except Exception:
        # Never log Firebase tokens or decoded authentication claims.
        return jsonify({"error": "invalid authentication"}), 401

    if decoded.get("email_verified") is not True:
        return jsonify({"error": "verified account required"}), 403

    email = decoded.get("email")

    if not isinstance(email, str) or not email:
        return jsonify({"error": "invalid authentication"}), 401

    allowed = admin_email_allowlist()

    if not allowed:
        return jsonify({"error": "admin service unavailable"}), 503

    normalized_email = email.strip().lower()

    if normalized_email not in allowed:
        return jsonify({"error": "admin access required"}), 403

    session_hash = admin_session_hash(normalized_email)

    if not session_hash:
        return jsonify({"error": "admin service unavailable"}), 503

    session.clear()
    session.permanent = True
    session["admin_hash"] = session_hash

    return "", 204


@app.route("/api/analytics", methods=["GET"])
def analytics():
    if not valid_admin_session():
        return jsonify({"error": "authentication required"}), 401

    range_key = request.args.get("range", "30d").strip().lower()

    range_days = {
        "7d": 7,
        "30d": 30,
        "90d": 90,
    }

    if range_key == "all":
        event_date_filter = "TRUE"
    elif range_key in range_days:
        days = range_days[range_key]
        event_date_filter = (
            "event_timestamp >= "
            f"TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {days} DAY)"
        )
    else:
        return jsonify({"error": "invalid analytics range"}), 400

    queries = {
        # Strict sequential funnel. Each stage must occur at or after the
        # previous stage for the SAME anonymous visitor, inside the selected
        # range. The previous implementation tested each stage independently,
        # so a visitor could be counted at "Scheduler opened" without ever
        # having registered or verified, producing impossible orderings.
        #
        # Verified membership comes from the trusted server-only
        # member_verified event, never from identity_links.linked_at: that
        # column records when the link row was written, and historical data
        # shows schedule_open/schedule_submit predating it.
        "funnel": f"""
            WITH admin_visitors AS (
              SELECT DISTINCT anonymous_id
              FROM `{PROJECT_ID}.{DATASET_ID}.identity_links`
              WHERE is_admin IS TRUE
            ),
            filtered_events AS (
              SELECT
                event.anonymous_id,
                event.event_name,
                event.event_timestamp
              FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
              WHERE {event_date_filter}
                AND event.anonymous_id IS NOT NULL
                AND COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
                AND NOT EXISTS (
                  SELECT 1
                  FROM admin_visitors AS admin
                  WHERE admin.anonymous_id = event.anonymous_id
                )
            ),
            visitors AS (
              SELECT
                anonymous_id,
                MIN(event_timestamp) AS visitor_at
              FROM filtered_events
              GROUP BY anonymous_id
            ),
            registration AS (
              SELECT
                visitor.anonymous_id,
                MIN(event.event_timestamp) AS registration_at
              FROM visitors AS visitor
              JOIN filtered_events AS event
                ON event.anonymous_id = visitor.anonymous_id
              WHERE event.event_name = 'member_register_open'
                AND event.event_timestamp >= visitor.visitor_at
              GROUP BY visitor.anonymous_id
            ),
            verified AS (
              SELECT
                registered.anonymous_id,
                MIN(event.event_timestamp) AS verified_at
              FROM registration AS registered
              JOIN filtered_events AS event
                ON event.anonymous_id = registered.anonymous_id
              WHERE event.event_name = 'member_verified'
                AND event.event_timestamp >= registered.registration_at
              GROUP BY registered.anonymous_id
            ),
            scheduler AS (
              SELECT
                member.anonymous_id,
                MIN(event.event_timestamp) AS scheduler_at
              FROM verified AS member
              JOIN filtered_events AS event
                ON event.anonymous_id = member.anonymous_id
              WHERE event.event_name = 'schedule_open'
                AND event.event_timestamp >= member.verified_at
              GROUP BY member.anonymous_id
            ),
            submitted AS (
              SELECT
                opened.anonymous_id,
                MIN(event.event_timestamp) AS schedule_submitted_at
              FROM scheduler AS opened
              JOIN filtered_events AS event
                ON event.anonymous_id = opened.anonymous_id
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

            ORDER BY stage_order
        """,

        # First-touch acquisition attribution.
        #
        # A visitor's acquisition source is their FIRST-EVER page_view, found
        # across all history and deliberately NOT restricted by the selected
        # range: someone acquired from a UTM campaign in August who returns
        # directly in September stays attributed to that campaign rather than
        # being reclassified as Direct.
        #
        # Funnel activity, by contrast, IS restricted to the selected range and
        # reuses the same strict sequential logic as the "funnel" query above.
        #
        # Visitors with no page_view anywhere in history are reported as
        # 'unknown' rather than dropped, so acquisition visitor totals
        # reconcile with the main funnel instead of silently under-counting.
        "acquisition": f"""
            WITH admin_visitors AS (
              SELECT DISTINCT anonymous_id
              FROM `{PROJECT_ID}.{DATASET_ID}.identity_links`
              WHERE is_admin IS TRUE
            ),
            first_touch AS (
              SELECT
                anonymous_id,
                referrer,
                utm_source,
                utm_medium,
                utm_campaign
              FROM (
                SELECT
                  event.anonymous_id,
                  event.referrer,
                  NULLIF(event.utm_source, '') AS utm_source,
                  NULLIF(event.utm_medium, '') AS utm_medium,
                  NULLIF(event.utm_campaign, '') AS utm_campaign,
                  ROW_NUMBER() OVER (
                    PARTITION BY event.anonymous_id
                    ORDER BY event.event_timestamp, event.event_id
                  ) AS row_num
                FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
                WHERE event.event_name = 'page_view'
                  AND event.anonymous_id IS NOT NULL
                  AND COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM admin_visitors AS admin
                    WHERE admin.anonymous_id = event.anonymous_id
                  )
              )
              WHERE row_num = 1
            ),
            attribution AS (
              SELECT
                anonymous_id,
                CASE
                  WHEN utm_source IS NOT NULL THEN 'utm'
                  WHEN referrer IS NULL OR referrer = '' THEN 'direct'
                  WHEN REGEXP_CONTAINS(
                    referrer,
                    r'^https://tulsahub\\.firebaseapp\\.com'
                  ) THEN 'authentication'
                  WHEN REGEXP_CONTAINS(
                    referrer,
                    r'^https://(www\\.)?gdgtulsa\\.com'
                  ) THEN 'internal'
                  ELSE 'referral'
                END AS source_type,
                CASE
                  WHEN utm_source IS NOT NULL THEN utm_source
                  WHEN referrer IS NULL OR referrer = ''
                    THEN '(direct / unknown)'
                  WHEN REGEXP_CONTAINS(
                    referrer,
                    r'^https://tulsahub\\.firebaseapp\\.com'
                  ) THEN 'tulsahub.firebaseapp.com'
                  WHEN REGEXP_CONTAINS(
                    referrer,
                    r'^https://(www\\.)?gdgtulsa\\.com'
                  ) THEN 'gdgtulsa.com'
                  ELSE COALESCE(NET.HOST(referrer), referrer)
                END AS source,
                utm_medium,
                utm_campaign
              FROM first_touch
            ),
            filtered_events AS (
              SELECT
                event.anonymous_id,
                event.event_name,
                event.event_timestamp
              FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
              WHERE {event_date_filter}
                AND event.anonymous_id IS NOT NULL
                AND COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
                AND NOT EXISTS (
                  SELECT 1
                  FROM admin_visitors AS admin
                  WHERE admin.anonymous_id = event.anonymous_id
                )
            ),
            visitors AS (
              SELECT
                anonymous_id,
                MIN(event_timestamp) AS visitor_at
              FROM filtered_events
              GROUP BY anonymous_id
            ),
            registration AS (
              SELECT
                visitor.anonymous_id,
                MIN(event.event_timestamp) AS registration_at
              FROM visitors AS visitor
              JOIN filtered_events AS event
                ON event.anonymous_id = visitor.anonymous_id
              WHERE event.event_name = 'member_register_open'
                AND event.event_timestamp >= visitor.visitor_at
              GROUP BY visitor.anonymous_id
            ),
            verified AS (
              SELECT
                registered.anonymous_id,
                MIN(event.event_timestamp) AS verified_at
              FROM registration AS registered
              JOIN filtered_events AS event
                ON event.anonymous_id = registered.anonymous_id
              WHERE event.event_name = 'member_verified'
                AND event.event_timestamp >= registered.registration_at
              GROUP BY registered.anonymous_id
            ),
            scheduler AS (
              SELECT
                member.anonymous_id,
                MIN(event.event_timestamp) AS scheduler_at
              FROM verified AS member
              JOIN filtered_events AS event
                ON event.anonymous_id = member.anonymous_id
              WHERE event.event_name = 'schedule_open'
                AND event.event_timestamp >= member.verified_at
              GROUP BY member.anonymous_id
            ),
            submitted AS (
              SELECT
                opened.anonymous_id,
                MIN(event.event_timestamp) AS schedule_submitted_at
              FROM scheduler AS opened
              JOIN filtered_events AS event
                ON event.anonymous_id = opened.anonymous_id
              WHERE event.event_name = 'schedule_submit'
                AND event.event_timestamp >= opened.scheduler_at
              GROUP BY opened.anonymous_id
            )
            SELECT
              COALESCE(source.source_type, 'unknown') AS source_type,
              COALESCE(source.source, '(unknown)') AS source,
              source.utm_medium,
              source.utm_campaign,
              COUNT(*) AS visitors,
              COUNTIF(registered.anonymous_id IS NOT NULL)
                AS registration_started,
              COUNTIF(member.anonymous_id IS NOT NULL) AS verified_members,
              COUNTIF(opened.anonymous_id IS NOT NULL) AS schedule_opened,
              COUNTIF(sent.anonymous_id IS NOT NULL) AS schedule_submitted
            FROM visitors AS visitor
            LEFT JOIN attribution AS source
              ON source.anonymous_id = visitor.anonymous_id
            LEFT JOIN registration AS registered
              ON registered.anonymous_id = visitor.anonymous_id
            LEFT JOIN verified AS member
              ON member.anonymous_id = visitor.anonymous_id
            LEFT JOIN scheduler AS opened
              ON opened.anonymous_id = visitor.anonymous_id
            LEFT JOIN submitted AS sent
              ON sent.anonymous_id = visitor.anonymous_id
            GROUP BY
              source_type,
              source,
              utm_medium,
              utm_campaign
            ORDER BY
              visitors DESC,
              source_type,
              source,
              utm_campaign
            LIMIT 50
        """,

        "pages": f"""
            WITH admin_visitors AS (
              SELECT DISTINCT anonymous_id
              FROM `{PROJECT_ID}.{DATASET_ID}.identity_links`
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
              FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
              WHERE event_name = 'page_view'
                AND {event_date_filter}
                AND COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
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
              ) AS page_views_per_visitor
            FROM normalized_page_views
            GROUP BY page_path
            ORDER BY page_views DESC
            LIMIT 50
        """,

        "sources": f"""
            WITH admin_visitors AS (
              SELECT DISTINCT anonymous_id
              FROM `{PROJECT_ID}.{DATASET_ID}.identity_links`
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
              FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
              WHERE event_name = 'page_view'
                AND {event_date_filter}
                AND COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
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
                    r'^https://tulsahub\\.firebaseapp\\.com'
                  ) THEN 'authentication'
                  WHEN REGEXP_CONTAINS(
                    referrer,
                    r'^https://(www\\.)?gdgtulsa\\.com'
                  ) THEN 'internal'
                  ELSE 'referral'
                END AS source_type,
                CASE
                  WHEN utm_source IS NOT NULL THEN utm_source
                  WHEN referrer IS NULL OR referrer = ''
                    THEN '(direct / unknown)'
                  WHEN REGEXP_CONTAINS(
                    referrer,
                    r'^https://tulsahub\\.firebaseapp\\.com'
                  ) THEN 'tulsahub.firebaseapp.com'
                  WHEN REGEXP_CONTAINS(
                    referrer,
                    r'^https://(www\\.)?gdgtulsa\\.com'
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
            ORDER BY sessions DESC
            LIMIT 50
        """,

        "trends": f"""
            WITH admin_visitors AS (
              SELECT DISTINCT anonymous_id
              FROM `{PROJECT_ID}.{DATASET_ID}.identity_links`
              WHERE is_admin IS TRUE
            ),
            filtered_events AS (
              SELECT
                FORMAT_DATE(
                  '%Y-%m-%d',
                  DATE(event_timestamp, 'America/Chicago')
                ) AS event_date,
                anonymous_id,
                session_id,
                event_name
              FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
              WHERE {event_date_filter}
                AND COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
                AND NOT EXISTS (
                  SELECT 1
                  FROM admin_visitors AS admin
                  WHERE admin.anonymous_id = event.anonymous_id
                )
            )
            SELECT
              event_date AS date,
              COUNT(DISTINCT anonymous_id) AS visitors,
              COUNT(
                DISTINCT IF(
                  event_name = 'page_view',
                  session_id,
                  NULL
                )
              ) AS sessions,
              COUNTIF(event_name = 'page_view') AS page_views,
              COUNT(
                DISTINCT IF(
                  event_name = 'member_register_open',
                  anonymous_id,
                  NULL
                )
              ) AS registration_starts,
              COUNT(
                DISTINCT IF(
                  event_name = 'schedule_submit',
                  anonymous_id,
                  NULL
                )
              ) AS schedule_submits
            FROM filtered_events
            GROUP BY event_date
            ORDER BY event_date
        """,

        # Traffic Quality.
        #
        # The audit surface for every exclusion the clean dashboards apply, so
        # this query deliberately does NOT filter admin or internal/test out.
        # It is the one place they stay visible.
        #
        # Precedence matches the reporting rule: a verified admin is reported
        # as admin whatever their browser claimed, because is_admin is trusted
        # server-side identity while traffic_type is only a browser hint.
        "traffic_quality": f"""
            WITH admin_visitors AS (
              SELECT DISTINCT anonymous_id
              FROM `{PROJECT_ID}.{DATASET_ID}.identity_links`
              WHERE is_admin IS TRUE
            ),
            classified AS (
              SELECT
                CASE
                  WHEN EXISTS (
                    SELECT 1
                    FROM admin_visitors AS admin
                    WHERE admin.anonymous_id = event.anonymous_id
                  ) THEN 'admin'
                  ELSE COALESCE(NULLIF(event.traffic_type, ''), 'production')
                END AS traffic_type,
                event.anonymous_id,
                event.session_id,
                event.event_name
              FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
              WHERE {event_date_filter}
                AND event.anonymous_id IS NOT NULL
            )
            SELECT
              traffic_type,
              COUNT(DISTINCT anonymous_id) AS visitors,
              COUNT(DISTINCT session_id) AS sessions,
              COUNTIF(event_name = 'page_view') AS page_views
            FROM classified
            GROUP BY traffic_type
            ORDER BY visitors DESC, traffic_type
        """,
    }

    try:
        payload = {
            "range": range_key,
        }

        for name, query in queries.items():
            rows = bq.query(query).result()
            payload[name] = [
                {key: row[key] for key in row.keys()}
                for row in rows
            ]

        # stage_order is the canonical ordering field for the funnel. UNION ALL
        # gives BigQuery no ordering obligation, so never let the rendered stage
        # sequence depend on the order rows happen to come back in.
        payload["funnel"].sort(key=lambda stage: stage["stage_order"])

    except Exception:
        # Never expose SQL, credentials, service-account details or query
        # internals to the browser.
        print("Private admin analytics query failure")
        return jsonify({"error": "analytics unavailable"}), 500

    return jsonify(payload), 200



IDENTITY_HASH_SECRET = os.environ.get("IDENTITY_HASH_SECRET", "")

# Meaningful milestones. Ordinary clicks are deliberately excluded: they add
# noise to a member timeline without changing the follow-up decision.
JOURNEY_MILESTONES = (
    "member_register_open",
    "member_verified",
    "schedule_open",
    "schedule_submit",
)

RECENTLY_ACTIVE_DAYS = 14


FOLLOWUP_MEMBER_REF_SECRET = os.environ.get("FOLLOWUP_MEMBER_REF_SECRET", "")

FOLLOW_UP_COLLECTION = "followUpStatus"

FOLLOW_UP_STATUSES = (
    "new",
    "reviewed",
    "contacted",
    "dismissed",
)

# Queue placement. Lower sorts first. Completed states sink to the bottom but
# stay visible: a dismissed member who has since submitted a schedule request
# still needs to be seen.
FOLLOW_UP_ORDER = {
    ("high", "new"): 0,
    ("high", "reviewed"): 1,
    ("medium", "new"): 2,
    ("medium", "reviewed"): 3,
}

FOLLOW_UP_COMPLETED_ORDER = {
    "contacted": 4,
    "dismissed": 5,
}

MEMBER_REF_PATTERN = re.compile(r"\A[0-9a-f]{64}\Z")

FOLLOW_UP_PRIORITIES = ("high", "medium", "low")

# Only these may be set from the browser. updatedAt and updatedBy are server
# generated, and member_ref is the document id, so none of them appear here.
FOLLOW_UP_EDITABLE = frozenset({
    "status",
    "priority",
    "owner",
    "note",
    "lastContactedAt",
    "nextAction",
    "followUpAt",
})

NOTE_MAX_LENGTH = 2000
NEXT_ACTION_MAX_LENGTH = 500

# Control characters have no place in an operator note and are the usual way a
# log line or a rendered cell gets broken. Tab and newline are kept.
CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def admin_directory():
    """Map each allowlisted admin's session hash to their address.

    The hash is what gets stored; the address is only ever resolved for
    display, so the operational store still holds no readable identity.
    """
    directory = {}

    for email in admin_email_allowlist():
        digest = admin_session_hash(email)

        if digest:
            directory[digest] = email

    return directory


def follow_up_defaults():
    """V1 documents carry only a status. Everything else reads as unset."""
    return {
        "status": "new",
        "priority": None,
        "owner": None,
        "owner_label": None,
        "note": "",
        "next_action": "",
        "last_contacted_at": None,
        "follow_up_at": None,
        "updated_at": None,
        "updated_by": None,
    }


def follow_up_state(data, directory=None):
    """Normalise a stored document into the shape the dashboard expects.

    Written so a document containing nothing but {"status": "reviewed"} — which
    is exactly what production holds today — round-trips unchanged.
    """
    state = follow_up_defaults()

    if not isinstance(data, dict):
        return state

    status = data.get("status")

    if status in FOLLOW_UP_STATUSES:
        state["status"] = status

    priority = data.get("priority")

    if priority in FOLLOW_UP_PRIORITIES:
        state["priority"] = priority

    owner = data.get("owner")

    if isinstance(owner, str) and owner:
        state["owner"] = owner
        # Unknown owner hash (admin removed from the allowlist) stays unlabelled
        # rather than guessing or leaking the raw hash as a name.
        state["owner_label"] = (directory or {}).get(owner)

    note = data.get("note")

    if isinstance(note, str):
        state["note"] = note[:NOTE_MAX_LENGTH]

    action = data.get("nextAction")

    if isinstance(action, str):
        state["next_action"] = action[:NEXT_ACTION_MAX_LENGTH]

    state["last_contacted_at"] = iso_timestamp(data.get("lastContactedAt"))
    state["follow_up_at"] = iso_timestamp(data.get("followUpAt"))
    state["updated_at"] = iso_timestamp(data.get("updatedAt"))

    updated_by = data.get("updatedBy")

    if isinstance(updated_by, str) and updated_by:
        state["updated_by"] = (directory or {}).get(updated_by)

    return state


class FollowUpInvalid(Exception):
    """One field failed validation. Carries the field name, never the value."""

    def __init__(self, field):
        super().__init__(field)
        self.field = field


def parse_follow_up_text(value, limit, field):
    """Plain operator text: no control characters, bounded length.

    Angle brackets and quotes are left intact — the dashboard renders every
    cell through textContent, so markup is displayed rather than executed, and
    mangling the note would lose meaning an operator actually typed.
    """
    if value is None:
        return ""

    if not isinstance(value, str):
        raise FollowUpInvalid(field)

    cleaned = CONTROL_CHARACTERS.sub("", value).strip()

    if len(cleaned) > limit:
        raise FollowUpInvalid(field)

    return cleaned


def _parse_iso(value, field):
    if not isinstance(value, str) or not value.strip():
        raise FollowUpInvalid(field)

    text = value.strip()

    # datetime.fromisoformat only learned to accept a trailing Z in 3.11; be
    # explicit rather than depend on the runtime version.
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise FollowUpInvalid(field)

    # A naive value is treated as UTC so the stored instant never depends on
    # whatever timezone the browser happened to be in.
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    parsed = parsed.astimezone(timezone.utc)

    if not 2000 <= parsed.year <= 2100:
        raise FollowUpInvalid(field)

    return parsed


def parse_follow_up_date(value, field):
    """A calendar day. Normalised to UTC midnight.

    followUpAt is a day an operator picks, not an instant. Truncating means
    "due today" stays due today instead of turning overdue at 00:00:01.
    """
    if value is None:
        return None

    return _parse_iso(value, field).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


def parse_follow_up_instant(value, field):
    """A real moment, such as when outreach actually happened."""
    if value is None:
        return None

    return _parse_iso(value, field).replace(microsecond=0)


def follow_up_updates(payload, directory, admin_hash):
    """Turn a validated request body into the fields to merge.

    Raises FollowUpInvalid on the first bad field. Anything not named here is
    rejected by the caller before this runs, so no unexpected key can reach
    Firestore.
    """
    updates = {}

    if "status" in payload:
        if payload["status"] not in FOLLOW_UP_STATUSES:
            raise FollowUpInvalid("status")

        updates["status"] = payload["status"]

    if "priority" in payload:
        priority = payload["priority"]

        if priority is not None and priority not in FOLLOW_UP_PRIORITIES:
            raise FollowUpInvalid("priority")

        updates["priority"] = priority

    if "owner" in payload:
        owner = payload["owner"]

        # Only an allowlisted admin's own hash is assignable, so the browser
        # cannot invent an owner or store free text here.
        if owner is not None and owner not in directory:
            raise FollowUpInvalid("owner")

        updates["owner"] = owner

    if "note" in payload:
        updates["note"] = parse_follow_up_text(
            payload["note"], NOTE_MAX_LENGTH, "note"
        )

    if "nextAction" in payload:
        updates["nextAction"] = parse_follow_up_text(
            payload["nextAction"], NEXT_ACTION_MAX_LENGTH, "nextAction"
        )

    if "followUpAt" in payload:
        updates["followUpAt"] = parse_follow_up_date(
            payload["followUpAt"], "followUpAt"
        )

    if "lastContactedAt" in payload:
        updates["lastContactedAt"] = parse_follow_up_instant(
            payload["lastContactedAt"], "lastContactedAt"
        )

    # One controlled action rather than trusting a browser clock: the server
    # decides both the status and the moment.
    if payload.get("contactedNow") is True:
        updates["status"] = "contacted"
        updates["lastContactedAt"] = firestore.SERVER_TIMESTAMP

    if payload.get("assignToMe") is True:
        updates["owner"] = admin_hash

    return updates


def member_ref(uid):
    """Stable opaque handle for a member, safe to hand to the browser.

    Keyed on its own long-lived secret rather than SESSION_SECRET: this value
    is a Firestore document id, so rotating the session signing key must not
    orphan every follow-up record. Distinct from firebase_uid_hash too, so the
    operational store cannot be correlated with analytics identity.
    """
    if not FOLLOWUP_MEMBER_REF_SECRET or not isinstance(uid, str) or not uid:
        return None

    return hmac.new(
        FOLLOWUP_MEMBER_REF_SECRET.encode(),
        f"gdg-followup-member-ref:{uid}".encode(),
        hashlib.sha256,
    ).hexdigest()


def follow_up_eligible(member):
    """Reuses the journey signal rather than scoring a second time."""
    return (
        member.get("activity_status") == "active"
        and member.get("interest_level") in ("high", "medium")
    )


def follow_up_sort_key(member):
    status = member.get("follow_up_status") or "new"
    level = member.get("interest_level") or "low"

    rank = FOLLOW_UP_COMPLETED_ORDER.get(
        status,
        FOLLOW_UP_ORDER.get((level, status), 6),
    )

    # Most recent meaningful activity first inside each group, then name so the
    # order never depends on dict or query iteration order.
    activity = member.get("last_meaningful_activity_at") or ""

    return (rank, activity == "", _invert_timestamp(activity), member.get("name", "").lower())


def _invert_timestamp(value):
    """Descending sort on an ISO string without reversing the whole tuple."""
    return tuple(-ord(character) for character in str(value))


def member_uid_hash(uid):
    """Hash a Firebase UID forward into the analytics identity space.

    Same keyed HMAC the collector uses when it writes identity_links, so the
    admin can resolve a member to their existing rows without the UID ever
    leaving this process. The reverse direction is never performed: a hash is
    never mapped back to a person, and the hash itself is never returned.
    """
    if not IDENTITY_HASH_SECRET or not isinstance(uid, str) or not uid:
        return None

    return hmac.new(
        IDENTITY_HASH_SECRET.encode(),
        uid.encode(),
        hashlib.sha256,
    ).hexdigest()


def iso_timestamp(value):
    if value is None:
        return None

    isoformat = getattr(value, "isoformat", None)
    return isoformat() if callable(isoformat) else str(value)


def format_signal_date(value):
    if value is None:
        return ""

    strftime = getattr(value, "strftime", None)
    return strftime("%b %-d") if callable(strftime) else ""


# ===================== Behavioural intent scoring (V1) =====================
#
# Deliberately rules-based, deterministic and explainable: every point a member
# scores traces to one observed production event, and every reason states what
# was observed rather than claiming anything about the person.
#
# This is NOT the same thing as the manual `priority` field. Intent answers
# "what does the behaviour suggest?"; priority answers "how urgently does an
# organiser want to act?". They are allowed to disagree, and intent never
# writes to priority.

INTENT_SCORING_VERSION = "v1"

INTENT_HIGH_THRESHOLD = 60
INTENT_MEDIUM_THRESHOLD = 30
INTENT_MAX_SCORE = 100

# One-time conversion signals. Presence scores once; repeating an action can
# never inflate the score, which is why these are booleans and not counts.
INTENT_ACTIONS = (
    ("has_schedule_submit", 35, "Submitted a schedule request"),
    ("has_partner_interest", 30, "Showed partner interest"),
    ("has_speaker_interest", 25, "Showed speaker interest"),
    ("has_member_verified", 20, "Completed member registration"),
    ("has_member_register_open", 10, "Opened member registration"),
    ("has_schedule_open", 8, "Opened scheduling"),
    ("has_email_click", 6, "Clicked an email link"),
)

# Capped so a burst of browsing can never outweigh a conversion action.
INTENT_SESSION_POINTS = ((4, 10), (3, 6), (2, 3))
INTENT_SESSION_CAP = 10

INTENT_ACTIVE_DAY_POINTS = ((5, 8), (4, 6), (3, 4), (2, 2))
INTENT_ACTIVE_DAY_CAP = 8

# (max age in days, points, reason)
INTENT_RECENCY = (
    (3, 15, "Active within the last 3 days"),
    (7, 10, "Active within the last 7 days"),
    (30, 5, "Active within the last 30 days"),
)


def intent_level(score):
    if score >= INTENT_HIGH_THRESHOLD:
        return "high"

    if score >= INTENT_MEDIUM_THRESHOLD:
        return "medium"

    return "low"


def _intent_days_since(value, now):
    """Whole days between an event and now, or None if unusable.

    Naive timestamps are treated as UTC rather than raising: a member with one
    odd row should still be scored, just without a recency bonus if the value
    cannot be read at all.
    """
    if value is None:
        return None

    if not isinstance(value, datetime):
        return None

    moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    delta = now - moment.astimezone(timezone.utc)

    if delta.total_seconds() < 0:
        # A future timestamp is bad data, not fresh activity.
        return None

    return delta.days


def score_intent(signals, now=None):
    """Score observed behaviour from 0-100. Pure: no I/O, no clock reads.

    `signals` is the aggregate row for one member. Missing keys, None values and
    unusable timestamps all degrade to "no contribution" rather than raising, so
    a sparse or malformed row scores 0 / low instead of breaking the queue.
    """
    now = now or datetime.now(timezone.utc)
    signals = signals or {}

    score = 0
    reasons = []

    for key, points, reason in INTENT_ACTIONS:
        if signals.get(key):
            score += points
            reasons.append((points, reason))

    sessions = signals.get("intent_session_count") or 0

    try:
        sessions = int(sessions)
    except (TypeError, ValueError):
        sessions = 0

    for threshold, points in INTENT_SESSION_POINTS:
        if sessions >= threshold:
            score += min(points, INTENT_SESSION_CAP)
            reasons.append((
                points,
                f"Returned across {sessions} sessions",
            ))
            break

    days_active = signals.get("intent_active_days") or 0

    try:
        days_active = int(days_active)
    except (TypeError, ValueError):
        days_active = 0

    for threshold, points in INTENT_ACTIVE_DAY_POINTS:
        if days_active >= threshold:
            score += min(points, INTENT_ACTIVE_DAY_CAP)
            reasons.append((
                points,
                f"Active on {days_active} different days",
            ))
            break

    age = _intent_days_since(signals.get("intent_last_activity_at"), now)

    if age is not None:
        for max_age, points, reason in INTENT_RECENCY:
            if age <= max_age:
                score += points
                reasons.append((points, reason))
                break

    score = max(0, min(INTENT_MAX_SCORE, score))

    # Highest contribution first; ties fall back to the declared order above so
    # the same signals always produce the same reason sequence.
    ordered = [
        reason
        for _, reason in sorted(
            reasons, key=lambda item: (-item[0], reasons.index(item))
        )
    ]

    return {
        "score": score,
        "level": intent_level(score),
        "reasons": ordered,
        "version": INTENT_SCORING_VERSION,
    }


def follow_up_signal(activity):
    """Deterministic, ordered, first match wins.

    Every branch is decided by a stored timestamp or a count, so the reason can
    always be stated in plain language. No scoring, no model, no opaque number.
    """
    if activity is None:
        return "none", "No website activity recorded"

    submitted = activity.get("schedule_submitted_at")
    opened = activity.get("schedule_opened_at")
    verified = activity.get("member_verified_at")
    registered = activity.get("registration_started_at")
    last_seen = activity.get("last_seen")
    sessions = int(activity.get("session_count") or 0)
    page_views = int(activity.get("page_view_count") or 0)

    if submitted is not None:
        return "high", f"Submitted a schedule request {format_signal_date(submitted)}"

    if opened is not None:
        return "high", f"Opened scheduler {format_signal_date(opened)}"

    if verified is not None and last_seen is not None:
        recent_cutoff = datetime.now(timezone.utc) - timedelta(
            days=RECENTLY_ACTIVE_DAYS
        )
        if last_seen >= recent_cutoff:
            return "medium", f"Verified member, active {format_signal_date(last_seen)}"

    if registered is not None:
        return "medium", f"Started registration {format_signal_date(registered)}"

    if sessions >= 3 or page_views >= 5:
        return "medium", (
            f"{page_views} page view{'' if page_views == 1 else 's'} "
            f"across {sessions} session{'' if sessions == 1 else 's'}"
        )

    if sessions == 0 and page_views == 0:
        return "none", "No activity in selected range"

    return "low", "Ordinary browsing"


def firestore_timestamp(value):
    if value is None:
        return None

    isoformat = getattr(value, "isoformat", None)

    if callable(isoformat):
        return isoformat()

    return str(value)


@app.route("/api/community", methods=["GET"])
def community():
    if not valid_admin_session():
        return jsonify({"error": "authentication required"}), 401

    try:
        db = firestore.client(app=firebase_app)

        members = []
        for document in db.collection("members").stream():
            data = document.to_dict() or {}

            members.append({
                "name": str(data.get("name") or ""),
                "email": str(data.get("email") or ""),
                "confirmed": bool(data.get("confirmed")),
                "created_at": firestore_timestamp(data.get("createdAt")),
                "terms_accepted_at": firestore_timestamp(
                    data.get("termsAcceptedAt")
                ),
            })

        registrations = []
        for document in db.collection("registrations").stream():
            data = document.to_dict() or {}

            registrations.append({
                "name": str(data.get("name") or ""),
                "email": str(data.get("email") or ""),
                "title": str(data.get("title") or ""),
                "type": str(data.get("type") or ""),
                "created_at": firestore_timestamp(data.get("createdAt")),
            })

        schedule_requests = []
        for document in db.collection("scheduleRequests").stream():
            data = document.to_dict() or {}

            schedule_requests.append({
                "name": str(data.get("name") or ""),
                "email": str(data.get("email") or ""),
                "title": str(data.get("title") or ""),
                "type": str(data.get("type") or ""),
                "created_at": firestore_timestamp(data.get("createdAt")),
            })

        payload = {
            "members": members,
            "registrations": registrations,
            "schedule_requests": schedule_requests,
            "summary": {
                "chapter_members_all_time": 39 + len(members),
                "new_members": len(members),
                "confirmed_members": sum(
                    1 for member in members
                    if member["confirmed"]
                ),
                "event_registrations": len(registrations),
                "schedule_requests": len(schedule_requests),
                "tickets_reserved": len(registrations),
            },
        }

        return jsonify(payload), 200

    except Exception:
        # Do not expose Firestore, IAM, project, or document details
        # to the browser.
        print("Private admin community query failure")
        return jsonify({"error": "community data unavailable"}), 500


def journey_query(event_date_filter):
    """One batched query for every member, keyed only by hashed identity.

    Shared-browser safety is enforced here rather than in Python: an
    anonymous_id linked to more than one distinct member is ambiguous, and
    ambiguous browsers are dropped from named aggregation entirely so the same
    history can never be attributed to two people. Members only learn that some
    activity was withheld, never whose it was.
    """
    return f"""
        WITH member_hashes AS (
          SELECT DISTINCT hash_value
          FROM UNNEST(@member_hashes) AS hash_value
        ),
        admin_visitors AS (
          SELECT DISTINCT anonymous_id
          FROM `{PROJECT_ID}.{DATASET_ID}.identity_links`
          WHERE is_admin IS TRUE
        ),
        -- Counted across every link, not just this batch: a browser shared with
        -- a member outside the batch is still ambiguous.
        anon_owners AS (
          SELECT
            anonymous_id,
            COUNT(DISTINCT firebase_uid_hash) AS owner_count
          FROM `{PROJECT_ID}.{DATASET_ID}.identity_links`
          GROUP BY anonymous_id
        ),
        member_links AS (
          SELECT DISTINCT
            link.firebase_uid_hash AS hash_value,
            link.anonymous_id
          FROM `{PROJECT_ID}.{DATASET_ID}.identity_links` AS link
          JOIN member_hashes
            ON member_hashes.hash_value = link.firebase_uid_hash
        ),
        eligible_links AS (
          SELECT member_links.hash_value, member_links.anonymous_id
          FROM member_links
          JOIN anon_owners
            ON anon_owners.anonymous_id = member_links.anonymous_id
          WHERE anon_owners.owner_count = 1
            AND NOT EXISTS (
              SELECT 1
              FROM admin_visitors AS admin
              WHERE admin.anonymous_id = member_links.anonymous_id
            )
        ),
        ambiguity AS (
          SELECT
            member_links.hash_value,
            COUNTIF(anon_owners.owner_count > 1) AS ambiguous_identity_count
          FROM member_links
          JOIN anon_owners
            ON anon_owners.anonymous_id = member_links.anonymous_id
          GROUP BY member_links.hash_value
        ),
        linked_counts AS (
          SELECT hash_value, COUNT(DISTINCT anonymous_id) AS linked_identity_count
          FROM eligible_links
          GROUP BY hash_value
        ),
        member_events AS (
          SELECT
            eligible_links.hash_value,
            event.session_id,
            event.event_name,
            event.event_timestamp,
            event.page_path,
            event.page_title
          FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
          JOIN eligible_links
            ON eligible_links.anonymous_id = event.anonymous_id
          WHERE {event_date_filter}
            AND COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
        ),
        activity AS (
          SELECT
            hash_value,
            MIN(event_timestamp) AS first_seen,
            MAX(event_timestamp) AS last_seen,
            COUNT(DISTINCT session_id) AS session_count,
            COUNTIF(event_name = 'page_view') AS page_view_count,
            MIN(IF(event_name = 'member_register_open', event_timestamp, NULL))
              AS registration_started_at,
            MIN(IF(event_name = 'member_verified', event_timestamp, NULL))
              AS member_verified_at,
            MIN(IF(event_name = 'schedule_open', event_timestamp, NULL))
              AS schedule_opened_at,
            MIN(IF(event_name = 'schedule_submit', event_timestamp, NULL))
              AS schedule_submitted_at,
            MAX(IF(
              event_name IN (
                'member_register_open',
                'member_verified',
                'schedule_open',
                'schedule_submit'
              ),
              event_timestamp,
              NULL
            )) AS last_meaningful_activity_at
          FROM member_events
          GROUP BY hash_value
        ),
        -- Acquisition is deliberately all-time and production-only: the range
        -- selector must not change where somebody originally came from, and an
        -- earlier test/internal/admin visit must never become the first touch.
        first_touch AS (
          SELECT
            hash_value,
            referrer,
            utm_source,
            utm_medium,
            utm_campaign
          FROM (
            SELECT
              eligible_links.hash_value,
              event.referrer,
              NULLIF(event.utm_source, '') AS utm_source,
              NULLIF(event.utm_medium, '') AS utm_medium,
              NULLIF(event.utm_campaign, '') AS utm_campaign,
              ROW_NUMBER() OVER (
                PARTITION BY eligible_links.hash_value
                ORDER BY event.event_timestamp, event.event_id
              ) AS row_num
            FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
            JOIN eligible_links
              ON eligible_links.anonymous_id = event.anonymous_id
            WHERE event.event_name = 'page_view'
              AND COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
          )
          WHERE row_num = 1
        ),
        -- Behavioural intent is deliberately all-time and production-only,
        -- for the same reason acquisition is: the analytics range selector must
        -- not change how interested somebody's behaviour looks, and the
        -- Follow-up Queue is an all-time operational view. Aggregated in one
        -- pass here rather than hydrating raw events into the application.
        intent_signals AS (
          SELECT
            eligible_links.hash_value,
            COUNTIF(event.event_name = 'schedule_submit') > 0 AS has_schedule_submit,
            COUNTIF(event.event_name = 'partner_interest') > 0 AS has_partner_interest,
            COUNTIF(event.event_name = 'speaker_interest') > 0 AS has_speaker_interest,
            COUNTIF(event.event_name = 'member_verified') > 0 AS has_member_verified,
            COUNTIF(event.event_name = 'member_register_open') > 0
              AS has_member_register_open,
            COUNTIF(event.event_name = 'schedule_open') > 0 AS has_schedule_open,
            COUNTIF(event.event_name = 'email_click') > 0 AS has_email_click,
            COUNT(DISTINCT event.session_id) AS intent_session_count,
            COUNT(DISTINCT DATE(event.event_timestamp)) AS intent_active_days,
            MAX(event.event_timestamp) AS intent_last_activity_at
          FROM `{PROJECT_ID}.{DATASET_ID}.events` AS event
          JOIN eligible_links
            ON eligible_links.anonymous_id = event.anonymous_id
          WHERE COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'
          GROUP BY eligible_links.hash_value
        ),
        recent_pages AS (
          SELECT
            hash_value,
            ARRAY_AGG(
              STRUCT(page_path, page_title, event_timestamp)
              ORDER BY event_timestamp DESC
              LIMIT 10
            ) AS pages
          FROM member_events
          WHERE event_name = 'page_view'
          GROUP BY hash_value
        )
        SELECT
          member_hashes.hash_value,
          activity.first_seen,
          activity.last_seen,
          activity.session_count,
          activity.page_view_count,
          activity.registration_started_at,
          activity.member_verified_at,
          activity.schedule_opened_at,
          activity.schedule_submitted_at,
          activity.last_meaningful_activity_at,
          COALESCE(linked_counts.linked_identity_count, 0) AS linked_identity_count,
          COALESCE(ambiguity.ambiguous_identity_count, 0) AS ambiguous_identity_count,
          -- Guarded: without a first_touch row the CASE would fall through to
          -- 'direct' and invent an acquisition source for a member who has no
          -- recorded activity at all.
          CASE
            WHEN first_touch.hash_value IS NULL THEN NULL
            WHEN first_touch.utm_source IS NOT NULL THEN 'utm'
            WHEN first_touch.referrer IS NULL OR first_touch.referrer = '' THEN 'direct'
            WHEN REGEXP_CONTAINS(
              first_touch.referrer,
              r'^https://tulsahub\\.firebaseapp\\.com'
            ) THEN 'authentication'
            WHEN REGEXP_CONTAINS(
              first_touch.referrer,
              r'^https://(www\\.)?gdgtulsa\\.com'
            ) THEN 'internal'
            ELSE 'referral'
          END AS first_source_type,
          CASE
            WHEN first_touch.hash_value IS NULL THEN NULL
            WHEN first_touch.utm_source IS NOT NULL THEN first_touch.utm_source
            WHEN first_touch.referrer IS NULL OR first_touch.referrer = ''
              THEN '(direct / unknown)'
            WHEN REGEXP_CONTAINS(
              first_touch.referrer,
              r'^https://tulsahub\\.firebaseapp\\.com'
            ) THEN 'tulsahub.firebaseapp.com'
            WHEN REGEXP_CONTAINS(
              first_touch.referrer,
              r'^https://(www\\.)?gdgtulsa\\.com'
            ) THEN 'gdgtulsa.com'
            ELSE COALESCE(NET.HOST(first_touch.referrer), first_touch.referrer)
          END AS first_source,
          first_touch.utm_medium AS first_medium,
          first_touch.utm_campaign AS first_campaign,
          recent_pages.pages AS recent_pages,
          intent_signals.has_schedule_submit,
          intent_signals.has_partner_interest,
          intent_signals.has_speaker_interest,
          intent_signals.has_member_verified,
          intent_signals.has_member_register_open,
          intent_signals.has_schedule_open,
          intent_signals.has_email_click,
          intent_signals.intent_session_count,
          intent_signals.intent_active_days,
          intent_signals.intent_last_activity_at
        FROM member_hashes
        LEFT JOIN activity ON activity.hash_value = member_hashes.hash_value
        LEFT JOIN linked_counts ON linked_counts.hash_value = member_hashes.hash_value
        LEFT JOIN ambiguity ON ambiguity.hash_value = member_hashes.hash_value
        LEFT JOIN first_touch ON first_touch.hash_value = member_hashes.hash_value
        LEFT JOIN recent_pages ON recent_pages.hash_value = member_hashes.hash_value
        LEFT JOIN intent_signals
          ON intent_signals.hash_value = member_hashes.hash_value
    """


@app.route("/api/journeys", methods=["GET"])
def journeys():
    if not valid_admin_session():
        return jsonify({"error": "authentication required"}), 401

    range_key = request.args.get("range", "30d").strip().lower()

    range_days = {
        "7d": 7,
        "30d": 30,
        "90d": 90,
    }

    if range_key == "all":
        event_date_filter = "TRUE"
    elif range_key in range_days:
        days = range_days[range_key]
        event_date_filter = (
            "event.event_timestamp >= "
            f"TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {days} DAY)"
        )
    else:
        return jsonify({"error": "invalid journey range"}), 400

    if not IDENTITY_HASH_SECRET:
        print("Private admin journeys identity secret unavailable")
        return jsonify({"error": "journeys unavailable"}), 500

    try:
        db = firestore.client(app=firebase_app)

        # One Firestore read for every member, mirroring /api/community.
        members = []
        hashes = []

        for document in db.collection("members").stream():
            data = document.to_dict() or {}

            # The document id is the Firebase UID. It is hashed immediately and
            # never stored, logged or returned.
            uid_hash = member_uid_hash(data.get("uid") or document.id)

            if not uid_hash:
                continue

            members.append({
                "name": str(data.get("name") or ""),
                "email": str(data.get("email") or ""),
                "confirmed": bool(data.get("confirmed")),
                "created_at": firestore_timestamp(data.get("createdAt")),
                "hash_value": uid_hash,
                "member_ref": member_ref(data.get("uid") or document.id),
            })
            hashes.append(uid_hash)

        activity_by_hash = {}

        if hashes:
            # One batched query for the whole member set, never one per member.
            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ArrayQueryParameter(
                        "member_hashes", "STRING", sorted(set(hashes))
                    )
                ]
            )

            rows = bq.query(
                journey_query(event_date_filter),
                job_config=job_config,
            ).result()

            for row in rows:
                activity_by_hash[row["hash_value"]] = row

        # One read of the operational collection for the whole queue. Absent
        # document means "new"; nothing is created just because somebody became
        # eligible, so the queue stays dynamic.
        follow_up_by_ref = {}
        directory = admin_directory()

        try:
            follow_up_db = firestore.client(app=followup_app)

            for document in follow_up_db.collection(FOLLOW_UP_COLLECTION).stream():
                follow_up_by_ref[document.id] = follow_up_state(
                    document.to_dict(), directory
                )
        except Exception:
            # Follow-up state is operational metadata. If it cannot be read the
            # journeys still render, every member simply shows as "new".
            print("Private admin follow-up status read failure")

        payload_members = []

        # One clock read for the whole response so every member in a single
        # payload is scored against the same instant.
        scored_at = datetime.now(timezone.utc)

        for member in members:
            row = activity_by_hash.get(member["hash_value"])

            # A fresh default per member; never a shared mutable object.
            follow_up = follow_up_by_ref.get(
                member["member_ref"]
            ) or follow_up_defaults()

            # Derived at request time from the aggregate row, never persisted.
            # A member with no analytics row scores 0 / low rather than being
            # skipped, so somebody nobody has looked at yet still appears.
            intent = score_intent(dict(row) if row else {}, scored_at)

            linked = int(row["linked_identity_count"]) if row else 0
            ambiguous = int(row["ambiguous_identity_count"]) if row else 0
            has_events = bool(row and row["first_seen"] is not None)

            if has_events:
                activity_status = "active"
            elif linked or ambiguous:
                activity_status = "no_activity_in_range"
            else:
                activity_status = "none"

            activity = None

            if has_events:
                activity = {
                    "schedule_submitted_at": row["schedule_submitted_at"],
                    "schedule_opened_at": row["schedule_opened_at"],
                    "member_verified_at": row["member_verified_at"],
                    "registration_started_at": row["registration_started_at"],
                    "last_seen": row["last_seen"],
                    "session_count": row["session_count"],
                    "page_view_count": row["page_view_count"],
                }
            elif activity_status == "no_activity_in_range":
                activity = {
                    "session_count": 0,
                    "page_view_count": 0,
                    "last_seen": None,
                    "schedule_submitted_at": None,
                    "schedule_opened_at": None,
                    "member_verified_at": None,
                    "registration_started_at": None,
                }

            interest_level, interest_reason = follow_up_signal(activity)

            recent = []

            if row and row["recent_pages"]:
                for page in row["recent_pages"]:
                    recent.append({
                        "page_path": page.get("page_path") or "",
                        "page_title": page.get("page_title") or "",
                        "viewed_at": iso_timestamp(page.get("event_timestamp")),
                    })

            payload_members.append({
                "name": member["name"],
                "email": member["email"],
                "confirmed": member["confirmed"],
                "created_at": member["created_at"],
                "activity_status": activity_status,
                "interest_level": interest_level,
                "interest_reason": interest_reason,
                "first_seen": iso_timestamp(row["first_seen"]) if row else None,
                "last_seen": iso_timestamp(row["last_seen"]) if row else None,
                "first_source_type": row["first_source_type"] if row else None,
                "first_source": row["first_source"] if row else None,
                "first_medium": row["first_medium"] if row else None,
                "first_campaign": row["first_campaign"] if row else None,
                "linked_identity_count": linked,
                "session_count": int(row["session_count"] or 0) if row else 0,
                "page_view_count": int(row["page_view_count"] or 0) if row else 0,
                "registration_started_at":
                    iso_timestamp(row["registration_started_at"]) if row else None,
                "member_verified_at":
                    iso_timestamp(row["member_verified_at"]) if row else None,
                "schedule_opened_at":
                    iso_timestamp(row["schedule_opened_at"]) if row else None,
                "schedule_submitted_at":
                    iso_timestamp(row["schedule_submitted_at"]) if row else None,
                "last_meaningful_activity_at":
                    iso_timestamp(row["last_meaningful_activity_at"]) if row else None,
                "recent_pages": recent,
                "has_ambiguous_activity": ambiguous > 0,
                "member_ref": member["member_ref"],
                # follow_up_status stays for the existing queue ordering; the
                # nested object carries the V2 operational fields alongside it.
                "follow_up_status": follow_up.get("status", "new"),
                "follow_up": follow_up,
                # System-derived and read-only: no PATCH accepts these.
                "intent_score": intent["score"],
                "intent_level": intent["level"],
                "intent_reasons": intent["reasons"],
                "intent_scoring_version": intent["version"],
            })

        order = {"high": 0, "medium": 1, "low": 2, "none": 3}
        payload_members.sort(
            key=lambda member: (
                order.get(member["interest_level"], 4),
                member["last_seen"] is None,
                member["name"].lower(),
            )
        )

        return jsonify({
            "range": range_key,
            "members": payload_members,
            # Assignable owners, by opaque hash with a display label resolved
            # server-side. The browser never chooses an arbitrary owner string.
            "admins": [
                {"id": digest, "label": label}
                for digest, label in sorted(directory.items(), key=lambda x: x[1])
            ],
            "current_admin": session.get("admin_hash"),
        }), 200

    except Exception:
        # Never expose Firestore, BigQuery, UID or identity details.
        print("Private admin journeys query failure")
        return jsonify({"error": "journeys unavailable"}), 500


@app.route("/api/follow-ups/<member_reference>", methods=["PATCH"])
def update_follow_up(member_reference):
    """Record a manual follow-up decision.

    The only state-changing endpoint in the admin service. Validation runs
    before anything is resolved or written, and the write targets the gdg-tulsa
    operational database only: member records in tulsahub stay read-only.
    """
    if not valid_admin_session():
        return jsonify({"error": "authentication required"}), 401

    # Same CSRF control the existing state-changing endpoints use. Fails closed
    # when Origin is absent, and the session cookie is already SameSite=Strict.
    if not same_origin_request():
        return jsonify({"error": "origin not allowed"}), 403

    if request.content_length and request.content_length > 4_000:
        return jsonify({"error": "payload too large"}), 413

    if not request.is_json:
        return jsonify({"error": "invalid payload"}), 400

    if not MEMBER_REF_PATTERN.match(str(member_reference or "")):
        return jsonify({"error": "invalid member reference"}), 400

    payload = request.get_json(silent=True) or {}

    if not isinstance(payload, dict):
        return jsonify({"error": "invalid payload"}), 400

    # Anything outside this set is refused rather than ignored, so a typo or a
    # attempt to set updatedAt/updatedBy/member_ref fails loudly.
    allowed_keys = FOLLOW_UP_EDITABLE | {
        "contactedNow", "assignToMe", "expectedUpdatedAt"
    }
    unknown = set(payload) - allowed_keys

    if unknown:
        return jsonify({"error": "unknown field"}), 400

    directory = admin_directory()
    admin_hash = session.get("admin_hash")

    try:
        updates = follow_up_updates(payload, directory, admin_hash)
    except FollowUpInvalid as invalid:
        return jsonify({"error": f"invalid {invalid.field}"}), 400

    if not updates:
        return jsonify({"error": "no changes supplied"}), 400

    if not FOLLOWUP_MEMBER_REF_SECRET:
        print("Private admin follow-up reference secret unavailable")
        return jsonify({"error": "follow-up unavailable"}), 500

    try:
        # Resolve against the live member list so a well-formed but unknown
        # reference cannot create an orphan document.
        member_db = firestore.client(app=firebase_app)
        known = False

        for document in member_db.collection("members").stream():
            data = document.to_dict() or {}

            if member_ref(data.get("uid") or document.id) == member_reference:
                known = True
                break

        if not known:
            return jsonify({"error": "member not found"}), 404

        follow_up_db = firestore.client(app=followup_app)
        reference = follow_up_db.collection(FOLLOW_UP_COLLECTION).document(
            member_reference
        )

        stored = {}

        try:
            snapshot = reference.get()

            if snapshot.exists:
                stored = snapshot.to_dict() or {}
        except Exception:
            # A missing prior value only affects the log line and the staleness
            # check below; the write itself still merges safely.
            pass

        current = follow_up_state(stored, directory)

        # Optimistic concurrency. The dashboard echoes back the updatedAt it
        # rendered; if the document moved on since then the edit is refused so
        # one admin cannot silently overwrite another's note. Omitting the
        # field keeps the old last-write-wins behaviour.
        expected = payload.get("expectedUpdatedAt")

        if expected is not None:
            if not isinstance(expected, str):
                return jsonify({"error": "invalid expectedUpdatedAt"}), 400

            if (current["updated_at"] or "") != expected:
                return jsonify({
                    "error": "follow-up changed since it was loaded",
                    "follow_up": current,
                }), 409

        # merge keeps every field the request did not mention. updatedBy is the
        # existing non-PII session hash: no email, name, uid or cookie.
        write = dict(updates)
        write["updatedAt"] = firestore.SERVER_TIMESTAMP
        write["updatedBy"] = admin_hash

        reference.set(write, merge=True)

        try:
            refreshed = follow_up_state(reference.get().to_dict(), directory)
        except Exception:
            refreshed = follow_up_state({**stored, **updates}, directory)

        # Short prefix and field names only: enough to correlate a change,
        # never the note text or anything identifying.
        print(
            "follow_up_status_updated "
            f"ref={member_reference[:8]} "
            f"old={current['status']} new={refreshed['status']} "
            f"fields={','.join(sorted(updates))}"
        )

        return jsonify({
            "status": refreshed["status"],
            "follow_up": refreshed,
        }), 200

    except Exception:
        # Never expose Firestore, IAM, project or document details.
        print("Private admin follow-up status write failure")
        return jsonify({"error": "follow-up unavailable"}), 500


@app.route("/logout", methods=["POST"])
def logout():
    if not same_origin_request():
        return jsonify({"error": "origin not allowed"}), 403

    session.clear()
    return "", 204


@app.route("/", methods=["GET"])
def dashboard():
    if not valid_admin_session():
        return redirect(url_for("login"), code=303)

    return render_template("dashboard.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)

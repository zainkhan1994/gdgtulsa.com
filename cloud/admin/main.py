import hashlib
import hmac
import os
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
          recent_pages.pages AS recent_pages
        FROM member_hashes
        LEFT JOIN activity ON activity.hash_value = member_hashes.hash_value
        LEFT JOIN linked_counts ON linked_counts.hash_value = member_hashes.hash_value
        LEFT JOIN ambiguity ON ambiguity.hash_value = member_hashes.hash_value
        LEFT JOIN first_touch ON first_touch.hash_value = member_hashes.hash_value
        LEFT JOIN recent_pages ON recent_pages.hash_value = member_hashes.hash_value
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

        payload_members = []

        for member in members:
            row = activity_by_hash.get(member["hash_value"])

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
        }), 200

    except Exception:
        # Never expose Firestore, BigQuery, UID or identity details.
        print("Private admin journeys query failure")
        return jsonify({"error": "journeys unavailable"}), 500


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

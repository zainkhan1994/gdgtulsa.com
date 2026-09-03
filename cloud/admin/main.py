import hashlib
import hmac
import os
from datetime import timedelta
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

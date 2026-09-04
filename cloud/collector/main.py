import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import auth as firebase_auth
from flask import Flask, jsonify, request
from google.cloud import bigquery

app = Flask(__name__)

PROJECT_ID = "gdg-tulsa"
DATASET_ID = "website_analytics"
TABLE_ID = "events"
IDENTITY_TABLE_ID = "identity_links"
FIREBASE_PROJECT_ID = "tulsahub"

TABLE = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"
IDENTITY_TABLE = f"{PROJECT_ID}.{DATASET_ID}.{IDENTITY_TABLE_ID}"

ALLOWED_ORIGINS = {
    "https://gdgtulsa.com",
    "https://www.gdgtulsa.com",
}

SERVER_ONLY_EVENTS = {
    "member_verified",
}

# Reporting hygiene, never authorisation. traffic_type only decides which rows
# the clean production dashboards leave out; verified-admin exclusion stays
# authoritative and server-side via identity_links.is_admin.
#
# Validated here independently of tracker.js: the browser is not trusted just
# because the shipped tracker happens to validate too.
TRAFFIC_TYPES = {
    "production",
    "internal",
    "test",
}


def normalize_traffic_type(value):
    """Anything unrecognised becomes 'production'.

    Normalising rather than rejecting is deliberate. Rejecting would let a
    malformed or future client value silently destroy real events, and would
    hand anyone a way to make the collector drop writes. Normalising keeps the
    event and lands it in the default bucket that IS reported, so bad input can
    never quietly hide traffic.
    """
    candidate = str(value or "").strip().lower()
    return candidate if candidate in TRAFFIC_TYPES else "production"

BOT_PATTERN = re.compile(
    r"bot|crawler|spider|slurp|bingpreview|facebookexternalhit",
    re.IGNORECASE,
)

bq = bigquery.Client(project=PROJECT_ID)

# Token verification is intentionally tied to the Firebase project that owns
# GDG Tulsa authentication, not to the analytics GCP project.
firebase_app = firebase_admin.initialize_app(
    options={"projectId": FIREBASE_PROJECT_ID}
)


def add_cors(response):
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.after_request
def after_request(response):
    return add_cors(response)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


def canonical_uuid(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def hash_firebase_uid(uid):
    secret = os.environ.get("IDENTITY_HASH_SECRET", "")
    if not secret:
        return None

    return hmac.new(
        secret.encode(),
        uid.encode(),
        hashlib.sha256,
    ).hexdigest()


def admin_email_allowlist():
    raw = os.environ.get("ADMIN_EMAILS", "")
    return {
        email.strip().lower()
        for email in raw.split(",")
        if email.strip()
    }


def store_member_verified_event(
    event_id,
    event_timestamp,
    anonymous_id,
    session_id,
    traffic_type,
):
    query = f"""
        MERGE `{TABLE}` AS target
        USING (
          SELECT
            @event_id AS event_id,
            @event_timestamp AS event_timestamp,
            @anonymous_id AS anonymous_id,
            @session_id AS session_id,
            @traffic_type AS traffic_type
        ) AS source
        ON target.event_id = source.event_id
        WHEN NOT MATCHED THEN
          INSERT (
            event_id,
            event_timestamp,
            anonymous_id,
            session_id,
            event_name,
            page_url,
            page_path,
            page_title,
            referrer,
            utm_source,
            utm_medium,
            utm_campaign,
            click_text,
            click_url,
            user_agent,
            ip_hash,
            traffic_type
          )
          VALUES (
            source.event_id,
            source.event_timestamp,
            source.anonymous_id,
            source.session_id,
            'member_verified',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            NULL,
            source.traffic_type
          )
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter(
                "event_id",
                "STRING",
                event_id,
            ),
            bigquery.ScalarQueryParameter(
                "event_timestamp",
                "TIMESTAMP",
                event_timestamp,
            ),
            bigquery.ScalarQueryParameter(
                "anonymous_id",
                "STRING",
                anonymous_id,
            ),
            bigquery.ScalarQueryParameter(
                "session_id",
                "STRING",
                session_id,
            ),
            bigquery.ScalarQueryParameter(
                "traffic_type",
                "STRING",
                traffic_type,
            ),
        ]
    )

    bq.query(query, job_config=job_config).result()


@app.route("/identify", methods=["OPTIONS"])
def identify_options():
    return "", 204


@app.route("/identify", methods=["POST"])
def identify():
    origin = request.headers.get("Origin")

    if origin not in ALLOWED_ORIGINS:
        return jsonify({"error": "origin not allowed"}), 403

    if request.content_length and request.content_length > 32_000:
        return jsonify({"error": "payload too large"}), 413

    if not request.is_json:
        return jsonify({"error": "invalid payload"}), 400

    payload = request.get_json(silent=True) or {}

    # Identity stitching is analytics processing and therefore follows the
    # same consent requirement as normal event collection.
    if payload.get("consent") is not True:
        return "", 204

    anonymous_id = canonical_uuid(payload.get("anonymous_id"))
    session_id = canonical_uuid(payload.get("session_id"))

    if not anonymous_id or not session_id:
        return jsonify({"error": "invalid identity fields"}), 400

    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")

    if scheme.lower() != "bearer" or not token:
        return jsonify({"error": "authentication required"}), 401

    try:
        decoded = firebase_auth.verify_id_token(
            token,
            app=firebase_app,
        )
    except Exception:
        # Never log the Firebase token or decoded claims.
        return jsonify({"error": "invalid authentication"}), 401

    if decoded.get("email_verified") is not True:
        return jsonify({"error": "verified member required"}), 403

    uid = decoded.get("uid")

    if not isinstance(uid, str) or not uid:
        return jsonify({"error": "invalid authentication"}), 401

    email = decoded.get("email")
    is_admin = (
        isinstance(email, str)
        and email.strip().lower() in admin_email_allowlist()
    )

    firebase_uid_hash = hash_firebase_uid(uid)

    if not firebase_uid_hash:
        return jsonify({"error": "identity service unavailable"}), 503

    # One trusted verification milestone per Firebase identity and browser.
    # The raw Firebase UID is never stored in analytics.
    member_verified_event_id = hashlib.sha256(
        (
            "member_verified:"
            f"{firebase_uid_hash}:{anonymous_id}"
        ).encode()
    ).hexdigest()

    # Stable for the same verified member/browser/session, so page refreshes
    # cannot create another identity row for that same session.
    link_id = hashlib.sha256(
        f"{firebase_uid_hash}:{anonymous_id}:{session_id}".encode()
    ).hexdigest()

    linked_at = datetime.now(timezone.utc)

    # BigQuery does not enforce unique keys. MERGE gives link_id real
    # idempotency rather than relying on best-effort streaming deduplication.
    query = f"""
        MERGE `{IDENTITY_TABLE}` AS target
        USING (
          SELECT
            @link_id AS link_id,
            @linked_at AS linked_at,
            @anonymous_id AS anonymous_id,
            @session_id AS session_id,
            @firebase_uid_hash AS firebase_uid_hash,
            @is_admin AS is_admin
        ) AS source
        ON target.link_id = source.link_id
        WHEN MATCHED THEN
          UPDATE SET
            is_admin = source.is_admin
        WHEN NOT MATCHED THEN
          INSERT (
            link_id,
            linked_at,
            anonymous_id,
            session_id,
            firebase_uid_hash,
            is_admin
          )
          VALUES (
            source.link_id,
            source.linked_at,
            source.anonymous_id,
            source.session_id,
            source.firebase_uid_hash,
            source.is_admin
          )
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("link_id", "STRING", link_id),
            bigquery.ScalarQueryParameter("linked_at", "TIMESTAMP", linked_at),
            bigquery.ScalarQueryParameter(
                "anonymous_id", "STRING", anonymous_id
            ),
            bigquery.ScalarQueryParameter(
                "session_id", "STRING", session_id
            ),
            bigquery.ScalarQueryParameter(
                "firebase_uid_hash", "STRING", firebase_uid_hash
            ),
            bigquery.ScalarQueryParameter(
                "is_admin", "BOOL", is_admin
            ),
        ]
    )

    try:
        bq.query(query, job_config=job_config).result()
    except Exception:
        # Do not log UID hashes or authentication information.
        print("Identity link storage failure")
        return jsonify({"error": "storage failure"}), 500

    try:
        store_member_verified_event(
            member_verified_event_id,
            linked_at,
            anonymous_id,
            session_id,
            normalize_traffic_type(payload.get("traffic_type")),
        )
    except Exception:
        # The deterministic event ID makes a later /identify retry safe.
        print("Verified member analytics storage failure")
        return jsonify({"error": "storage failure"}), 500

    return "", 204


@app.route("/collect", methods=["OPTIONS"])
def collect_options():
    return "", 204


@app.route("/collect", methods=["POST"])
def collect():
    origin = request.headers.get("Origin")

    if origin not in ALLOWED_ORIGINS:
        return jsonify({"error": "origin not allowed"}), 403

    if request.content_length and request.content_length > 32_000:
        return jsonify({"error": "payload too large"}), 413

    if request.is_json:
        payload = request.get_json(silent=True) or {}
    else:
        try:
            payload = json.loads(request.get_data(as_text=True) or "{}")
        except json.JSONDecodeError:
            return jsonify({"error": "invalid payload"}), 400

    # Do not collect analytics until the browser indicates consent.
    if payload.get("consent") is not True:
        return "", 204

    user_agent = request.headers.get("User-Agent", "")

    if BOT_PATTERN.search(user_agent):
        return "", 204

    event_name = str(payload.get("event_name", ""))[:100]
    session_id = str(payload.get("session_id", ""))[:200]
    anonymous_id = str(payload.get("anonymous_id", ""))[:200]

    if not event_name or not session_id or not anonymous_id:
        return jsonify({"error": "missing required fields"}), 400

    if event_name in SERVER_ONLY_EVENTS:
        return jsonify({"error": "event not allowed"}), 400

    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.remote_addr or "")

    secret = os.environ.get("IP_HASH_SECRET", "")

    if secret and ip:
        ip_hash = hmac.new(
            secret.encode(),
            ip.encode(),
            hashlib.sha256,
        ).hexdigest()
    else:
        ip_hash = None

    row = {
        "event_id": str(uuid.uuid4()),
        "event_timestamp": datetime.now(timezone.utc).isoformat(),
        "anonymous_id": anonymous_id,
        "session_id": session_id,
        "event_name": event_name,
        "page_url": str(payload.get("page_url", ""))[:2000],
        "page_path": str(payload.get("page_path", ""))[:1000],
        "page_title": str(payload.get("page_title", ""))[:500],
        "referrer": str(payload.get("referrer", ""))[:2000],
        "utm_source": str(payload.get("utm_source", ""))[:300],
        "utm_medium": str(payload.get("utm_medium", ""))[:300],
        "utm_campaign": str(payload.get("utm_campaign", ""))[:300],
        "click_text": str(payload.get("click_text", ""))[:500],
        "click_url": str(payload.get("click_url", ""))[:2000],
        "user_agent": user_agent[:1000],
        "ip_hash": ip_hash,
        "traffic_type": normalize_traffic_type(payload.get("traffic_type")),
    }

    errors = bq.insert_rows_json(TABLE, [row])

    if errors:
        print(f"BigQuery insert errors: {errors}")
        return jsonify({"error": "storage failure"}), 500

    return "", 204


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)

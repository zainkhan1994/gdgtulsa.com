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

    queries = {
        "funnel": f"""
            SELECT
              stage_order,
              stage,
              visitors,
              percent_of_visitors
            FROM `{PROJECT_ID}.{DATASET_ID}.conversion_funnel`
            ORDER BY stage_order
        """,
        "pages": f"""
            SELECT
              page_path,
              page_views,
              unique_visitors,
              sessions,
              page_views_per_visitor
            FROM `{PROJECT_ID}.{DATASET_ID}.page_traffic`
            ORDER BY page_views DESC
            LIMIT 50
        """,
        "sources": f"""
            SELECT
              source_type,
              source,
              utm_medium,
              utm_campaign,
              sessions,
              unique_visitors
            FROM `{PROJECT_ID}.{DATASET_ID}.traffic_sources`
            ORDER BY sessions DESC
            LIMIT 50
        """,
    }

    try:
        payload = {}

        for name, query in queries.items():
            rows = bq.query(query).result()
            payload[name] = [
                {key: row[key] for key in row.keys()}
                for row in rows
            ]

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

"""Test bootstrap for the private admin service.

main.py builds a BigQuery client and two Firebase apps at import time, so both
are replaced with inert stubs before the module is loaded. No test in this
directory reaches Google Cloud, and none of them writes anything.
"""

import os
import sys
import types
from pathlib import Path

import pytest

ADMIN_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = ADMIN_DIR.parents[1]

TEST_SECRET = "test-session-secret-not-a-real-value"
TEST_ADMIN_EMAIL = "admin@example.test"
ORIGIN = "https://admin.test"


def _install_stubs():
    """Replace the cloud clients main.py builds during import."""
    import firebase_admin
    from google.cloud import bigquery

    firebase_admin.initialize_app = lambda *a, **k: types.SimpleNamespace()
    bigquery.Client = lambda *a, **k: types.SimpleNamespace()


@pytest.fixture(scope="session")
def admin_module():
    os.environ["SESSION_SECRET"] = TEST_SECRET
    os.environ["ADMIN_EMAILS"] = TEST_ADMIN_EMAIL

    _install_stubs()

    sys.path.insert(0, str(ADMIN_DIR))
    import main

    main.app.config.update(TESTING=True)
    return main


@pytest.fixture
def client(admin_module):
    # base_url must be https so the Secure session cookie is actually sent.
    return admin_module.app.test_client()


@pytest.fixture
def signed_in(client, admin_module):
    # Secure cookie: the transaction must use the same https origin as requests.
    with client.session_transaction(base_url=ORIGIN) as sess:
        sess["admin_hash"] = admin_module.admin_session_hash(TEST_ADMIN_EMAIL)
    return client


@pytest.fixture(scope="session")
def dashboard_html():
    return (ADMIN_DIR / "templates" / "dashboard.html").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def login_html():
    return (ADMIN_DIR / "templates" / "login.html").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def admin_js():
    return (ADMIN_DIR / "static" / "admin.js").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def admin_css():
    return (ADMIN_DIR / "static" / "admin.css").read_text(encoding="utf-8")

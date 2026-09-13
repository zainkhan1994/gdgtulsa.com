"""Authentication and routing invariants.

The redesign is presentation-only, so every one of these must behave exactly as
it did before it.
"""

import pytest

ORIGIN = "https://admin.test"
VALID_REF = "a" * 64


@pytest.mark.parametrize("path", ["/api/analytics", "/api/community", "/api/journeys"])
def test_api_requires_authentication(client, path):
    response = client.get(path, base_url=ORIGIN)
    assert response.status_code == 401
    assert response.get_json()["error"] == "authentication required"


def test_follow_up_patch_requires_authentication(client):
    response = client.patch(
        f"/api/follow-ups/{VALID_REF}",
        json={"status": "reviewed"},
        base_url=ORIGIN,
    )
    assert response.status_code == 401


def test_health_is_public(client):
    response = client.get("/health", base_url=ORIGIN)
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_login_page_is_public(client):
    response = client.get("/login", base_url=ORIGIN)
    assert response.status_code == 200


def test_dashboard_redirects_when_signed_out(client):
    response = client.get("/", base_url=ORIGIN)
    assert response.status_code == 303
    assert "/login" in response.headers["Location"]


def test_dashboard_renders_when_signed_in(signed_in):
    response = signed_in.get("/", base_url=ORIGIN)
    assert response.status_code == 200
    assert b"GDG Tulsa Admin Dashboard" in response.data


def test_security_headers_still_applied(client):
    response = client.get("/login", base_url=ORIGIN)
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Content-Type-Options"] == "nosniff"

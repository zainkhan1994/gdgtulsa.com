"""admin.js behavioural contract.

These guard the parts of the frontend that talk to the backend or handle member
data. A redesign is allowed to change how things look, never what is requested
or what is exposed.
"""

import re


def test_api_urls_unchanged(admin_js):
    urls = sorted(set(re.findall(r'fetch\(\s*[`"]([^`"]+)', admin_js)))
    assert urls == [
        "/api/analytics?range=${encodeURIComponent(range)}",
        "/api/community",
        "/api/follow-ups/${encodeURIComponent(memberRef)}",
        "/api/journeys?range=${encodeURIComponent(range)}",
        "/logout",
        "/session",
    ]


def test_follow_up_uses_patch(admin_js):
    block = admin_js[admin_js.index("async function saveFollowUpStatus"):]
    assert 'method: "PATCH"' in block[:600]
    assert 'credentials: "same-origin"' in block[:600]


def test_follow_up_statuses_unchanged(admin_js):
    match = re.search(r"FOLLOW_UP_STATUSES = \[([^\]]+)\]", admin_js)
    statuses = re.findall(r'"([a-z]+)"', match.group(1))
    assert statuses == ["new", "reviewed", "contacted", "dismissed"]


def test_failed_status_save_restores_previous_value(admin_js):
    block = admin_js[admin_js.index("select.addEventListener"):]
    block = block[: block.index("action.appendChild")]
    assert "const previous = item.follow_up_status" in block
    assert "select.value = previous;" in block
    assert "Follow-up status could not be saved." in block


def test_unauthorised_response_redirects_to_login(admin_js):
    assert admin_js.count('window.location.replace("/login")') == 4


def test_follow_up_queue_is_not_range_filtered(admin_js):
    """Eligibility comes from the journey signal, never the range selector."""
    block = admin_js[admin_js.index("const followUps = journeys"):]
    block = block[: block.index("renderFollowUps(followUps)")]
    assert "range" not in block
    assert 'activity_status === "active"' in block
    assert 'interest_level === "high"' in block
    assert 'interest_level === "medium"' in block


def test_journeys_endpoint_is_range_sensitive(admin_js):
    assert "/api/journeys?range=${encodeURIComponent(range)}" in admin_js


def test_member_ref_is_never_written_to_the_dom(admin_js):
    """member_ref may be held in memory for the PATCH, but never rendered."""
    for match in re.finditer(r"member_ref", admin_js):
        line = admin_js[: match.start()].count("\n")
        source = admin_js.splitlines()[line]
        assert "textContent" not in source
        assert "innerHTML" not in source
        assert "setAttribute" not in source
        assert "dataset" not in source


def test_no_technical_identifier_is_rendered(admin_js):
    forbidden = [
        "firebase_uid_hash", "anonymous_id", "session_id",
        "ip_hash", "uid_hash", "user_agent",
    ]
    for term in forbidden:
        assert term not in admin_js, f"{term} appears in admin.js"


def test_no_debug_logging_ships(admin_js):
    assert "console.log" not in admin_js
    assert "console.debug" not in admin_js
    assert "window.__" not in admin_js


def test_funnel_percentage_comes_from_the_backend(admin_js):
    """The bar is drawn from percent_of_visitors; it is never recomputed."""
    block = admin_js[admin_js.index("function renderFunnel"):]
    block = block[: block.index("function renderPages")]
    assert "percent_of_visitors" in block
    assert "/ totalVisitors" not in block


def test_funnel_sorted_by_stage_order(admin_js):
    block = admin_js[admin_js.index("function renderFunnel"):]
    assert "stage_order" in block[:900]


def test_overlapping_refresh_is_prevented(admin_js):
    block = admin_js[admin_js.index("async function loadDashboard"):]
    assert "if (dashboardLoading) return;" in block[:400]


def test_refresh_does_not_reload_the_page(admin_js):
    assert "location.reload" not in admin_js


def test_chart_uses_no_external_library(admin_js):
    assert "createElementNS" in admin_js
    assert "http://www.w3.org/2000/svg" in admin_js
    for library in ["chart.js", "new Chart", "d3.select", "plotly", "echarts"]:
        assert library.lower() not in admin_js.lower()
    assert "cdn" not in admin_js.lower().replace("cdn-cgi", "")


def test_chart_has_an_accessible_label(admin_js):
    block = admin_js[admin_js.index("function renderTrendsChart"):]
    assert 'role: "img"' in block
    assert '"aria-label"' in block


def test_status_badges_carry_text_not_just_colour(admin_js):
    block = admin_js[admin_js.index("function badgeElement"):]
    assert "badge.textContent = text;" in block[:400]


def test_empty_states_exist_for_every_table(admin_js):
    for message in [
        "No verified members yet.",
        "Nobody needs follow-up right now.",
        "No acquisition sources were recorded for this period.",
        "No traffic sources recorded for this period.",
        "No funnel activity for this period.",
    ]:
        assert message in admin_js


def test_skeletons_are_cleared_on_success_and_failure(admin_js):
    # Anchor on loadAnalytics: the file has other finally blocks.
    block = admin_js[admin_js.index("async function loadAnalytics"):]
    block = block[block.index("  } finally {"):]
    assert "hideSkeletons();" in block[:300]

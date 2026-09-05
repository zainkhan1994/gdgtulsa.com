"""Structural contract between dashboard.html and admin.js.

admin.js finds everything by data attribute and hard-codes colSpan values for
empty states. If either drifts the dashboard silently renders nothing, which is
exactly the failure a visual redesign is most likely to introduce.
"""

import re

import pytest

# Every attribute admin.js queries, and where it must live.
DASHBOARD_HOOKS = [
    "data-analytics-root", "data-analytics-status", "data-analytics-content",
    "data-metrics", "data-analytics-refresh", "data-analytics-range",
    "data-updated-at", "data-admin-signout", "data-community-status",
    "data-community-metrics", "data-community-content",
    "data-total-visitors", "data-total-page-views", "data-total-sessions",
    "data-chapter-members", "data-new-members", "data-confirmed-members",
    "data-registration-count", "data-schedule-count",
    "data-trends-body", "data-funnel-body", "data-pages-body",
    "data-acquisition-body", "data-sources-body", "data-traffic-quality-body",
    "data-journeys-body", "data-follow-ups-body",
    "data-members-body", "data-registrations-body", "data-schedules-body",
    "data-activity-list",
]

LOGIN_HOOKS = ["data-google-login", "data-auth-status"]

# tbody hook -> column count locked by the colSpan values inside admin.js.
COLUMN_COUNTS = {
    "data-trends-body": 6,
    "data-funnel-body": 3,
    "data-pages-body": 5,
    "data-acquisition-body": 8,
    "data-sources-body": 6,
    "data-traffic-quality-body": 4,
    "data-journeys-body": 8,
    "data-follow-ups-body": 9,
    "data-members-body": 5,
    "data-registrations-body": 5,
    "data-schedules-body": 5,
}


@pytest.mark.parametrize("hook", DASHBOARD_HOOKS)
def test_dashboard_keeps_js_hook(dashboard_html, hook):
    assert hook in dashboard_html


@pytest.mark.parametrize("hook", LOGIN_HOOKS)
def test_login_keeps_js_hook(login_html, hook):
    assert hook in login_html


@pytest.mark.parametrize("hook,expected", COLUMN_COUNTS.items())
def test_table_column_count_matches_colspan(dashboard_html, hook, expected):
    head = dashboard_html[: dashboard_html.index(hook)]
    thead = head.rindex("<thead>")
    assert len(re.findall(r"<th ", head[thead:])) == expected


def test_every_colspan_in_js_matches_a_table(admin_js, dashboard_html):
    """No empty-state row may span more columns than its table has."""
    spans = {int(n) for n in re.findall(r"colSpan = (\d+)", admin_js)}
    spans |= {int(n) for n in re.findall(r"emptyRow\(\s*\w+,\s*(\d+)", admin_js)}
    assert spans <= set(COLUMN_COUNTS.values()) | {6}


def test_date_range_options_unchanged(dashboard_html):
    """Scoped to the analytics range control: the follow-up queue filters
    contribute their own options and must not be able to mask a change here."""
    block = dashboard_html[dashboard_html.index("data-analytics-range"):]
    block = block[: block.index("</select>")]
    options = re.findall(r'<option value="([^"]+)"', block)
    assert options == ["7d", "30d", "90d", "all"]


def test_default_range_is_thirty_days(dashboard_html):
    assert re.search(r'<option value="30d" selected>', dashboard_html)


def test_follow_up_queue_declares_all_time_scope(dashboard_html):
    section = dashboard_html[dashboard_html.index('id="follow-up-queue"'):]
    assert "All-time operational queue" in section
    assert "independent of the selected analytics" in section


def test_sidebar_navigation_labels(dashboard_html):
    for label in [
        "Dashboard", "Analytics", "Visitor Intelligence",
        "Follow-up Queue", "Community", "Events", "Schedule Requests",
    ]:
        assert f"<span>{label}</span>" in dashboard_html


def test_every_sidebar_link_targets_a_real_section(dashboard_html):
    targets = re.findall(r'class="sidebar-link" href="#([a-z-]+)"', dashboard_html)
    assert targets, "sidebar produced no links"
    for target in targets:
        assert f'id="{target}"' in dashboard_html, f"#{target} has no destination"


def test_no_fake_search_control(dashboard_html):
    assert "type=\"search\"" not in dashboard_html
    assert "Search" not in dashboard_html


def test_no_fake_settings_destination(dashboard_html):
    assert ">Settings<" not in dashboard_html


def test_mobile_navigation_is_accessible(dashboard_html):
    toggle = dashboard_html[dashboard_html.index("data-sidebar-toggle"):]
    assert 'aria-controls="admin-sidebar"' in toggle[:400]
    assert 'aria-expanded="false"' in toggle[:400]
    assert 'id="admin-sidebar"' in dashboard_html


def test_skeleton_placeholders_present(dashboard_html):
    assert "data-skeleton" in dashboard_html
    assert dashboard_html.count("skeleton-card") == 6


def test_live_regions_preserved(dashboard_html):
    # analytics status, community status, and the follow-up result count.
    assert dashboard_html.count('aria-live="polite"') == 3
    assert dashboard_html.count('role="status"') == 3


def test_skip_link_present(dashboard_html):
    assert 'class="skip-link" href="#main-content"' in dashboard_html
    assert 'id="main-content"' in dashboard_html


def test_decorative_icons_are_hidden_from_assistive_tech(dashboard_html):
    for match in re.finditer(r"<svg[^>]*>", dashboard_html):
        svg = match.group(0)
        if 'aria-hidden="true"' in svg or 'class="nav-icon"' in svg:
            continue
        # Otherwise the whole subtree must already be hidden by its wrapper.
        wrapper = dashboard_html[max(0, match.start() - 220): match.start()]
        assert 'aria-hidden="true"' in wrapper, svg


def test_page_still_blocks_indexing(dashboard_html, login_html):
    for markup in (dashboard_html, login_html):
        assert 'content="noindex, nofollow, noarchive"' in markup

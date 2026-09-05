"""Behavioural intent scoring V1.

score_intent() is pure, so these exercise it directly with no Firestore,
BigQuery or clock dependency. Every expected number is written out rather than
recomputed from the constants, so a weight change has to be deliberate.
"""

from datetime import datetime, timedelta, timezone

import pytest

NOW = datetime(2026, 9, 5, 12, 0, 0, tzinfo=timezone.utc)


def ago(days):
    return NOW - timedelta(days=days)


def sig(**kwargs):
    """A signal row with everything absent unless named."""
    return kwargs


# ----------------------------------------------------------- no signals


def test_no_signals_scores_zero_low(admin_module):
    result = admin_module.score_intent({}, NOW)

    assert result["score"] == 0
    assert result["level"] == "low"
    assert result["reasons"] == []
    assert result["version"] == "v1"


def test_none_signals_is_safe(admin_module):
    assert admin_module.score_intent(None, NOW)["score"] == 0


# ------------------------------------------------- one-time conversions


@pytest.mark.parametrize("key,points,reason", [
    ("has_schedule_submit", 35, "Submitted a schedule request"),
    ("has_partner_interest", 30, "Showed partner interest"),
    ("has_speaker_interest", 25, "Showed speaker interest"),
    ("has_member_verified", 20, "Completed member registration"),
    ("has_member_register_open", 10, "Opened member registration"),
    ("has_schedule_open", 8, "Opened scheduling"),
    ("has_email_click", 6, "Clicked an email link"),
])
def test_each_conversion_signal(admin_module, key, points, reason):
    result = admin_module.score_intent(sig(**{key: True}), NOW)

    assert result["score"] == points
    assert reason in result["reasons"]


def test_conversion_signals_are_counted_once_not_per_event(admin_module):
    """The aggregate exposes presence, so repeats cannot inflate the score."""
    once = admin_module.score_intent(sig(has_email_click=True), NOW)
    # Even if the underlying member clicked fifty times, the flag is still True.
    again = admin_module.score_intent(sig(has_email_click=True), NOW)

    assert once["score"] == again["score"] == 6


def test_false_signals_contribute_nothing(admin_module):
    result = admin_module.score_intent(
        sig(has_schedule_submit=False, has_partner_interest=False), NOW)

    assert result["score"] == 0
    assert result["reasons"] == []


def test_conversions_accumulate(admin_module):
    result = admin_module.score_intent(
        sig(has_schedule_submit=True, has_schedule_open=True), NOW)

    assert result["score"] == 43
    assert result["level"] == "medium"


# ------------------------------------------------------ return sessions


@pytest.mark.parametrize("sessions,points", [
    (0, 0), (1, 0), (2, 3), (3, 6), (4, 10), (9, 10), (500, 10),
])
def test_session_bands_and_cap(admin_module, sessions, points):
    result = admin_module.score_intent(sig(intent_session_count=sessions), NOW)
    assert result["score"] == points


def test_sessions_never_exceed_their_cap(admin_module):
    """Hundreds of sessions must not approach a conversion action's weight."""
    result = admin_module.score_intent(sig(intent_session_count=10_000), NOW)
    assert result["score"] == 10
    assert result["score"] < 35


def test_session_reason_states_the_count(admin_module):
    result = admin_module.score_intent(sig(intent_session_count=3), NOW)
    assert "Returned across 3 sessions" in result["reasons"]


# --------------------------------------------------------- active days


@pytest.mark.parametrize("days,points", [
    (0, 0), (1, 0), (2, 2), (3, 4), (4, 6), (5, 8), (40, 8),
])
def test_active_day_bands_and_cap(admin_module, days, points):
    result = admin_module.score_intent(sig(intent_active_days=days), NOW)
    assert result["score"] == points


# --------------------------------------------------------------- recency


@pytest.mark.parametrize("days,points", [
    (0, 15), (3, 15), (4, 10), (7, 10), (8, 5), (30, 5), (31, 0), (400, 0),
])
def test_recency_bands(admin_module, days, points):
    result = admin_module.score_intent(
        sig(intent_last_activity_at=ago(days)), NOW)
    assert result["score"] == points


def test_naive_timestamp_treated_as_utc(admin_module):
    naive = datetime(2026, 9, 5, 10, 0, 0)
    result = admin_module.score_intent(sig(intent_last_activity_at=naive), NOW)
    assert result["score"] == 15


def test_future_timestamp_scores_no_recency(admin_module):
    """Bad data, not fresh activity."""
    result = admin_module.score_intent(
        sig(intent_last_activity_at=NOW + timedelta(days=5)), NOW)
    assert result["score"] == 0


@pytest.mark.parametrize("value", [None, "yesterday", 0, [], {}])
def test_unusable_timestamp_is_ignored_not_fatal(admin_module, value):
    result = admin_module.score_intent(sig(intent_last_activity_at=value), NOW)
    assert result["score"] == 0
    assert result["level"] == "low"


# ------------------------------------------------------ combined + caps


def test_combined_score(admin_module):
    result = admin_module.score_intent(sig(
        has_schedule_submit=True,      # 35
        has_schedule_open=True,        # 8
        intent_session_count=3,        # 6
        intent_active_days=2,          # 2
        intent_last_activity_at=ago(2),  # 15
    ), NOW)

    assert result["score"] == 66
    assert result["level"] == "high"


def test_score_is_capped_at_100(admin_module):
    result = admin_module.score_intent(sig(
        has_schedule_submit=True, has_partner_interest=True,
        has_speaker_interest=True, has_member_verified=True,
        has_member_register_open=True, has_schedule_open=True,
        has_email_click=True,
        intent_session_count=50, intent_active_days=50,
        intent_last_activity_at=ago(0),
    ), NOW)

    assert result["score"] == 100
    assert result["level"] == "high"


def test_score_is_never_negative(admin_module):
    result = admin_module.score_intent(
        sig(intent_session_count=-5, intent_active_days=-9), NOW)
    assert result["score"] >= 0


# ------------------------------------------------------------ thresholds


@pytest.mark.parametrize("score_signals,level", [
    (sig(has_schedule_submit=True, has_partner_interest=True), "high"),      # 65
    (sig(has_schedule_submit=True, has_member_register_open=True,
         intent_last_activity_at=None), "medium"),                          # 45
    (sig(has_email_click=True), "low"),                                     # 6
])
def test_levels(admin_module, score_signals, level):
    assert admin_module.score_intent(score_signals, NOW)["level"] == level


def test_threshold_boundaries_are_inclusive(admin_module):
    assert admin_module.intent_level(60) == "high"
    assert admin_module.intent_level(59) == "medium"
    assert admin_module.intent_level(30) == "medium"
    assert admin_module.intent_level(29) == "low"
    assert admin_module.intent_level(0) == "low"


def test_thresholds_are_named_constants(admin_module):
    assert admin_module.INTENT_HIGH_THRESHOLD == 60
    assert admin_module.INTENT_MEDIUM_THRESHOLD == 30
    assert admin_module.INTENT_MAX_SCORE == 100


# ----------------------------------------------------------- reasons


def test_reasons_ordered_by_contribution(admin_module):
    result = admin_module.score_intent(sig(
        has_email_click=True,          # 6
        has_schedule_submit=True,      # 35
        has_speaker_interest=True,     # 25
        intent_last_activity_at=ago(1),  # 15
    ), NOW)

    assert result["reasons"] == [
        "Submitted a schedule request",
        "Showed speaker interest",
        "Active within the last 3 days",
        "Clicked an email link",
    ]


def test_reason_order_is_deterministic(admin_module):
    signals = sig(has_schedule_open=True, has_member_register_open=True,
                  intent_session_count=4, intent_active_days=5)
    assert [admin_module.score_intent(signals, NOW)["reasons"] for _ in range(5)].count(
        admin_module.score_intent(signals, NOW)["reasons"]) == 5


def test_only_contributing_reasons_are_returned(admin_module):
    result = admin_module.score_intent(
        sig(has_schedule_submit=True, intent_session_count=1), NOW)

    assert result["reasons"] == ["Submitted a schedule request"]
    assert not any("session" in r for r in result["reasons"])


def test_reasons_describe_observed_behaviour_not_certainty(admin_module):
    """Language check: the UI must not claim to know what a person wants."""
    seen = set()

    for key, _, reason in admin_module.INTENT_ACTIONS:
        seen.add(reason)
    for _, _, reason in admin_module.INTENT_RECENCY:
        seen.add(reason)

    banned = ["ready to buy", "hot lead", "definitely", "will convert",
              "guaranteed", "wants", "certain", "likely customer"]

    for reason in seen:
        lowered = reason.lower()
        for phrase in banned:
            assert phrase not in lowered, f"{reason!r} overclaims"


def test_expected_reason_wording_is_pinned(admin_module):
    result = admin_module.score_intent(sig(has_schedule_submit=True), NOW)
    assert result["reasons"] == ["Submitted a schedule request"]


# ------------------------------------------------------------- version


def test_version_returned(admin_module):
    assert admin_module.score_intent({}, NOW)["version"] == "v1"
    assert admin_module.INTENT_SCORING_VERSION == "v1"


def test_scoring_is_pure_and_reproducible(admin_module):
    signals = sig(has_partner_interest=True, intent_session_count=4,
                  intent_last_activity_at=ago(5))
    first = admin_module.score_intent(signals, NOW)
    second = admin_module.score_intent(signals, NOW)

    assert first == second


def test_score_decreases_as_activity_ages(admin_module):
    """Documented V1 behaviour: recency decays, so a score can fall with no
    new events. Nothing persists a historical score."""
    signals = sig(has_schedule_open=True)

    fresh = admin_module.score_intent(
        {**signals, "intent_last_activity_at": ago(1)}, NOW)
    stale = admin_module.score_intent(
        {**signals, "intent_last_activity_at": ago(60)}, NOW)

    assert fresh["score"] > stale["score"]


# --------------------------------------------- no page-view domination


def test_page_views_award_no_points(admin_module):
    """V1 deliberately ignores raw page-view volume."""
    result = admin_module.score_intent(
        sig(page_view_count=5000, intent_session_count=1), NOW)
    assert result["score"] == 0


def test_passive_browsing_never_outranks_a_conversion(admin_module):
    """The check §56 calls out: heavy browsing must not beat a real action."""
    passive = admin_module.score_intent(sig(
        intent_session_count=500, intent_active_days=500,
        page_view_count=10_000, intent_last_activity_at=ago(0),
    ), NOW)

    converter = admin_module.score_intent(sig(
        has_schedule_submit=True, intent_session_count=1,
        intent_last_activity_at=ago(0),
    ), NOW)

    assert converter["score"] > passive["score"]


# =================== data integration and exclusions ===================
#
# Scoring reads one aggregate row. These pin the properties of the query that
# produces it, because that is where the hygiene actually lives.


def query_sql(admin_module):
    return admin_module.journey_query("TRUE")


def intent_cte(admin_module):
    sql = query_sql(admin_module)
    start = sql.index("intent_signals AS (")
    return sql[start: sql.index("recent_pages AS (", start)]


def test_intent_aggregation_is_production_traffic_only(admin_module):
    """test and internal traffic can never contribute a point."""
    block = intent_cte(admin_module)
    assert "COALESCE(NULLIF(event.traffic_type, ''), 'production') = 'production'" in block


def test_intent_aggregation_excludes_admin_linked_activity(admin_module):
    """Admin exclusion is inherited from eligible_links, not re-implemented."""
    block = intent_cte(admin_module)
    assert "JOIN eligible_links" in block

    sql = query_sql(admin_module)
    eligible = sql[sql.index("eligible_links AS ("): sql.index("ambiguity AS (")]
    assert "admin_visitors" in eligible
    assert "owner_count = 1" in eligible


def test_admin_visitors_are_defined_by_is_admin(admin_module):
    sql = query_sql(admin_module)
    block = sql[sql.index("admin_visitors AS ("): sql.index("anon_owners AS (")]
    assert "is_admin IS TRUE" in block


def test_intent_is_all_time_not_range_filtered(admin_module):
    """The range selector must not change how interested behaviour looks; the
    Follow-up Queue is an all-time operational view."""
    block = intent_cte(admin_module)
    assert "{event_date_filter}" not in block
    # The range filter is applied to member_events, which intent does not use.
    sql = query_sql(admin_module)
    member_events = sql[sql.index("member_events AS ("): sql.index("activity AS (")]
    assert "TRUE" in member_events


def test_intent_aggregation_is_a_single_grouped_pass(admin_module):
    """One aggregate for every member: no per-member query, no N+1."""
    block = intent_cte(admin_module)
    assert block.count("SELECT") == 1
    assert "GROUP BY eligible_links.hash_value" in block


def test_intent_uses_presence_not_counts(admin_module):
    """COUNTIF(...) > 0 is what makes duplicate events unable to inflate."""
    block = intent_cte(admin_module)
    for event in ["schedule_submit", "partner_interest", "speaker_interest",
                  "member_verified", "member_register_open", "schedule_open",
                  "email_click"]:
        assert f"COUNTIF(event.event_name = '{event}') > 0" in block


def test_only_real_production_event_names_are_scored(admin_module):
    """Every scored event must be one the collector actually writes."""
    import re
    from pathlib import Path

    collector = Path(admin_module.__file__).parents[1] / "collector" / "main.py"
    tracker = Path(admin_module.__file__).parents[2] / "tracker.js"
    known = collector.read_text() + tracker.read_text()

    block = intent_cte(admin_module)
    for event in re.findall(r"event\.event_name = '([a-z_]+)'", block):
        assert event in known, f"{event} is not an event this system emits"


def test_member_verified_cannot_be_forged_by_a_browser(admin_module):
    """It carries 20 points, so it matters that /collect refuses it."""
    from pathlib import Path
    collector = (Path(admin_module.__file__).parents[1] / "collector" / "main.py").read_text()

    block = collector[collector.index("SERVER_ONLY_EVENTS"):]
    assert "member_verified" in block[:200]
    assert "if event_name in SERVER_ONLY_EVENTS" in collector


def test_intent_fields_are_not_patchable(admin_module):
    """System-derived: no admin can set a score."""
    editable = admin_module.FOLLOW_UP_EDITABLE
    for field in ["intent_score", "intentScore", "intent_level", "intentLevel",
                  "intent_reasons", "intentReasons", "intent_scoring_version"]:
        assert field not in editable


def test_scoring_reads_only_aggregate_keys(admin_module):
    """No identity value reaches the scorer, so none can reach a reason."""
    signals = {
        "has_schedule_submit": True,
        "anonymous_id": "should-be-ignored",
        "session_id": "should-be-ignored",
        "hash_value": "should-be-ignored",
        "ip_hash": "should-be-ignored",
        "intent_last_activity_at": ago(1),
    }
    result = admin_module.score_intent(signals, NOW)

    blob = repr(result)
    for forbidden in ["should-be-ignored", "anonymous_id", "hash_value", "ip_hash"]:
        assert forbidden not in blob


def test_missing_session_id_or_row_still_scores(admin_module):
    """A member with no analytics row at all must still appear, at 0 / low."""
    result = admin_module.score_intent({}, NOW)
    assert result == {"score": 0, "level": "low", "reasons": [],
                      "version": "v1"}


def test_intent_does_not_touch_follow_up_state(admin_module):
    """Scoring must never write operational state."""
    defaults = admin_module.follow_up_defaults()
    before = dict(defaults)
    admin_module.score_intent({"has_schedule_submit": True}, NOW)
    assert defaults == before
    assert "intent" not in repr(defaults)

"""Behavioural tests for the hardened billing-shutdown function.

Every test runs against fake clients. No test reaches the Cloud Billing API,
the Budgets API, Pub/Sub, or any real project.
"""

import base64
import json

import pytest
from google.api_core import exceptions as api_exceptions
from google.cloud.billing import budgets_v1

from conftest import (
    FakeBillingClient, FakeBudgetClient, OTHER_BUDGET_ID, TEST_BILLING_ACCOUNT,
    TEST_BUDGET_ID, TEST_PROJECT, billing_main, make_event, marker_names, markers,
)


# --- 1. the one case that actually disables billing ----------------------

def test_correct_event_disables_billing_exactly_once(call, billing, budgets, capsys):
    call(make_event(), billing, budgets)

    assert len(billing.update_calls) == 1
    assert billing.update_calls[0] == (f"projects/{TEST_PROJECT}", "")
    assert "billing_shutdown_completed" in marker_names(capsys)
    assert billing.billing_enabled is False


def test_completed_is_not_logged_at_an_error_severity(call, billing, budgets, capsys):
    """A successful shutdown is not an application error; a dedicated metric
    matches the marker instead."""
    call(make_event(), billing, budgets)
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_completed"][0]
    assert entry["severity"] not in ("ERROR", "CRITICAL", "ALERT", "EMERGENCY")
    assert entry["project_id"] == TEST_PROJECT
    assert "costAmount" not in json.dumps(entry)


# --- 2/3/21/22/23. duplicate delivery ------------------------------------

def test_same_event_twice_mutates_once(call, billing, budgets, capsys):
    call(make_event(), billing, budgets)
    call(make_event(), billing, budgets)

    assert len(billing.update_calls) == 1
    assert marker_names(capsys).count("billing_shutdown_noop_already_disabled") == 1


def test_same_event_ten_times_reaches_identical_state(call, billing, budgets):
    for _ in range(10):
        call(make_event(), billing, budgets)

    assert len(billing.update_calls) == 1
    assert billing.billing_enabled is False


def test_duplicate_cloudevent_id_is_safe(call, billing, budgets):
    for _ in range(3):
        call(make_event(event_id="same-cloudevent-id"), billing, budgets)
    assert len(billing.update_calls) == 1


def test_duplicate_pubsub_message_id_is_safe(call, billing, budgets):
    for _ in range(3):
        call(make_event(message_id="same-message-id"), billing, budgets)
    assert len(billing.update_calls) == 1


def test_ambiguous_timeout_after_successful_api_call_is_safe(call, billing, budgets, capsys):
    """The Billing API succeeded but the ack was lost; the retry must no-op."""
    call(make_event(), billing, budgets)
    assert len(billing.update_calls) == 1

    # Same event redelivered because the platform never saw an acknowledgement.
    call(make_event(event_id="evt-1", message_id="msg-1"), billing, budgets)

    assert len(billing.update_calls) == 1
    assert "billing_shutdown_noop_already_disabled" in marker_names(capsys)


def test_concurrent_duplicate_delivery_is_safe(call, budgets):
    """Duplicate safety must not depend on max-instances=1 / concurrency=1."""
    import threading

    shared = FakeBillingClient()
    lock = threading.Lock()
    guarded_update = shared.update_project_billing_info

    def serialised(name, project_billing_info):
        with lock:
            return guarded_update(name, project_billing_info)

    shared.update_project_billing_info = serialised

    threads = [threading.Thread(target=call, args=(make_event(), shared, budgets))
               for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Worst case every thread reads "enabled" before any writes, so the unlink
    # may run more than once — the point is that the end state is identical and
    # every call is the same set-to-state operation.
    assert shared.billing_enabled is False
    assert all(call_args == (f"projects/{TEST_PROJECT}", "") for call_args in shared.update_calls)


# --- 4/5. other budgets on the shared topic ------------------------------

def test_wrong_budget_id_is_ignored_without_touching_billing(call, billing, budgets, capsys):
    event = make_event(attributes={
        "budgetId": OTHER_BUDGET_ID,
        "billingAccountId": TEST_BILLING_ACCOUNT,
        "schemaVersion": "1.0",
    })
    call(event, billing, budgets)

    assert billing.update_calls == []
    assert billing.get_calls == []
    assert budgets.calls == []
    assert "billing_shutdown_event_ignored" in marker_names(capsys)


def test_other_budget_ignore_is_routine_not_an_error(call, billing, budgets, capsys):
    """The $100 budget publishes here daily; it must not alert."""
    event = make_event(
        payload={"budgetDisplayName": "Other Budget", "costAmount": 500.0,
                 "budgetAmount": 100.0, "alertThresholdExceeded": 1.0},
        attributes={"budgetId": OTHER_BUDGET_ID,
                    "billingAccountId": TEST_BILLING_ACCOUNT, "schemaVersion": "1.0"})
    call(event, billing, budgets)

    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_event_ignored"][0]
    assert entry["severity"] == "INFO"
    assert billing.update_calls == []


def test_display_name_alone_cannot_authorise_shutdown(call, billing, budgets, capsys):
    """A forged message naming the real budget but carrying another id is inert."""
    event = make_event(
        payload={"budgetDisplayName": "GDG Tulsa $80 Shutdown Budget",
                 "costAmount": 999999.0, "budgetAmount": 1.0,
                 "alertThresholdExceeded": 1.0},
        attributes={"budgetId": OTHER_BUDGET_ID,
                    "billingAccountId": TEST_BILLING_ACCOUNT, "schemaVersion": "1.0"})
    call(event, billing, budgets)

    assert billing.update_calls == []
    assert "billing_shutdown_event_ignored" in marker_names(capsys)


# --- 6. wrong billing account --------------------------------------------

def test_wrong_billing_account_is_rejected(call, billing, budgets, capsys):
    event = make_event(attributes={
        "budgetId": TEST_BUDGET_ID,
        "billingAccountId": "OTHER0-000000-000000",
        "schemaVersion": "1.0",
    })
    call(event, billing, budgets)

    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_permanent_reject"][0]
    assert entry["reason"] == "billing_account_mismatch"
    assert entry["severity"] == "ERROR"


# --- 7-11. malformed input -----------------------------------------------

@pytest.mark.parametrize("event,reason", [
    (make_event(raw_data="!!!not base64!!!", payload=None), "base64_invalid"),
    (make_event(raw_data=base64.b64encode(b"{not json").decode(), payload=None), "json_invalid"),
    (make_event(raw_data=base64.b64encode(b'"a string"').decode(), payload=None), "json_not_object"),
    (make_event(message=None), "cloudevent_data_missing"),
    (make_event(message={"attributes": {}}), "message_data_missing"),
    (make_event(message={"data": None, "attributes": {}}), "message_data_missing"),
])
def test_malformed_delivery_is_permanently_rejected(call, billing, budgets, capsys, event, reason):
    call(event, billing, budgets)

    assert billing.update_calls == []
    assert billing.get_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_permanent_reject"][0]
    assert entry["reason"] == reason


@pytest.mark.parametrize("payload,reason", [
    ({"budgetAmount": 80.0}, "costAmount_invalid"),
    ({"costAmount": 95.0}, "budgetAmount_invalid"),
    ({"costAmount": "abc", "budgetAmount": 80.0}, "costAmount_invalid"),
    ({"costAmount": None, "budgetAmount": 80.0}, "costAmount_invalid"),
    ({"costAmount": True, "budgetAmount": 80.0}, "costAmount_invalid"),
    ({"costAmount": [95], "budgetAmount": 80.0}, "costAmount_invalid"),
    ({"costAmount": -5.0, "budgetAmount": 80.0}, "costAmount_invalid"),
    ({"costAmount": "NaN", "budgetAmount": 80.0}, "costAmount_invalid"),
    ({"costAmount": "Infinity", "budgetAmount": 80.0}, "costAmount_invalid"),
    ({"costAmount": 95.0, "budgetAmount": "-inf"}, "budgetAmount_invalid"),
    ({"costAmount": 95.0, "budgetAmount": 80.0, "alertThresholdExceeded": "abc"},
     "alert_threshold_invalid"),
])
def test_invalid_numbers_are_permanently_rejected(call, billing, budgets, capsys, payload, reason):
    call(make_event(payload=payload), billing, budgets)

    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_permanent_reject"][0]
    assert entry["reason"] == reason


def test_missing_budget_id_attribute_reports_what_did_arrive(call, billing, budgets, capsys):
    """The only diagnostic available: Pub/Sub attributes appear in no other log."""
    event = make_event(attributes={"billingAccountId": TEST_BILLING_ACCOUNT,
                                   "schemaVersion": "1.0"})
    call(event, billing, budgets)

    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_permanent_reject"][0]
    assert entry["reason"] == "budget_id_attribute_missing"
    assert entry["severity"] == "ERROR"
    assert entry["attribute_keys"] == "billingAccountId,schemaVersion"
    assert billing.update_calls == []


def test_unsupported_schema_version_is_rejected(call, billing, budgets, capsys):
    event = make_event(attributes={"budgetId": TEST_BUDGET_ID,
                                   "billingAccountId": TEST_BILLING_ACCOUNT,
                                   "schemaVersion": "2.0"})
    call(event, billing, budgets)

    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_permanent_reject"][0]
    assert entry["reason"] == "schema_version_unsupported"


# --- 12/13. threshold not reached ----------------------------------------

def test_cost_below_budget_takes_no_action_but_still_verifies(call, billing, budgets, capsys):
    """Readiness check runs on routine traffic so a broken Budgets API surfaces
    every twenty minutes rather than at the one moment it matters."""
    call(make_event(payload={"costAmount": 0.04, "budgetAmount": 80.0}), billing, budgets)

    assert billing.update_calls == []
    assert billing.get_calls == []
    assert len(budgets.calls) == 1
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_no_action"][0]
    assert entry["reason"] == "cost_below_budget"
    assert entry["severity"] == "INFO"
    assert entry["verification"] == "ok"


def test_threshold_below_shutdown_takes_no_action(call, billing, budgets, capsys):
    call(make_event(payload={"costAmount": 95.0, "budgetAmount": 80.0,
                             "alertThresholdExceeded": 0.5}), billing, budgets)

    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_no_action"][0]
    assert entry["reason"] == "threshold_below_shutdown"


def test_absent_threshold_field_still_allows_shutdown(call, billing, budgets):
    """Schema 1.0 omits alertThresholdExceeded on informational updates."""
    call(make_event(payload={"costAmount": 95.0, "budgetAmount": 80.0}), billing, budgets)
    assert len(billing.update_calls) == 1


# --- 14/15. GetBudget configuration verification -------------------------

def test_budget_amount_mismatch_blocks_shutdown(call, billing, capsys):
    call(make_event(), billing, FakeBudgetClient(units="500"))

    assert billing.update_calls == []
    assert billing.get_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_configuration_error"][0]
    assert entry["reason"] == "budget_amount_mismatch"


def test_missing_shutdown_threshold_rule_blocks_shutdown(call, billing, capsys):
    call(make_event(), billing, FakeBudgetClient(threshold=0.5))

    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_configuration_error"][0]
    assert entry["reason"] == "budget_threshold_rule_missing"


def test_forecasted_spend_basis_blocks_shutdown(call, billing, capsys):
    call(make_event(), billing,
         FakeBudgetClient(basis=budgets_v1.ThresholdRule.Basis.FORECASTED_SPEND))

    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_configuration_error"][0]
    assert entry["reason"] == "budget_threshold_rule_missing"


def test_budget_not_found_blocks_shutdown(call, billing, capsys):
    call(make_event(), billing, FakeBudgetClient(error=api_exceptions.NotFound("gone")))

    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_configuration_error"][0]
    assert entry["reason"] == "shutdown_budget_not_found"


def test_get_budget_is_addressed_from_configuration_only(call, billing, budgets):
    call(make_event(), billing, budgets)
    assert budgets.calls == [
        f"billingAccounts/{TEST_BILLING_ACCOUNT}/budgets/{TEST_BUDGET_ID}"]


# --- 16. billing already disabled ----------------------------------------

def test_already_disabled_is_a_clean_noop(call, budgets, capsys):
    client = FakeBillingClient(billing_enabled=False)
    call(make_event(), client, budgets)

    assert client.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_noop_already_disabled"][0]
    assert entry["severity"] == "INFO"


# --- 17-20. transient failures must raise --------------------------------

@pytest.mark.parametrize("error", [
    api_exceptions.ServiceUnavailable("503"),
    api_exceptions.DeadlineExceeded("timeout"),
    api_exceptions.Aborted("aborted"),
    api_exceptions.PermissionDenied("denied"),
    api_exceptions.InternalServerError("500"),
    api_exceptions.TooManyRequests("429"),
])
def test_transient_update_failure_raises(billing, budgets, capsys, error):
    client = FakeBillingClient(update_error=error)

    with pytest.raises(type(error)):
        billing_main.handle(make_event(), client, budgets)

    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_transient_failure"][0]
    assert entry["stage"] == "update_project_billing_info"
    assert entry["severity"] == "ERROR"


@pytest.mark.parametrize("error", [
    api_exceptions.ServiceUnavailable("503"),
    api_exceptions.DeadlineExceeded("timeout"),
    api_exceptions.PermissionDenied("denied"),
])
def test_transient_get_billing_failure_raises(budgets, capsys, error):
    client = FakeBillingClient(get_error=error)

    with pytest.raises(type(error)):
        billing_main.handle(make_event(), client, budgets)

    assert client.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_transient_failure"][0]
    assert entry["stage"] == "get_project_billing_info"


@pytest.mark.parametrize("error", [
    api_exceptions.ServiceUnavailable("503"),
    api_exceptions.PermissionDenied("denied"),
])
def test_transient_get_budget_failure_raises_at_threshold(billing, capsys, error):
    """At the threshold the check is mandatory, so the event must retry."""
    with pytest.raises(type(error)):
        billing_main.handle(make_event(), billing, FakeBudgetClient(error=error))

    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_transient_failure"][0]
    assert entry["stage"] == "get_budget"


# ================= Stage 2: readiness verification semantics =================

BELOW_THRESHOLD = {"costAmount": 0.04, "budgetAmount": 80.0}


def test_below_threshold_verification_runs_and_passes(call, billing, budgets, capsys):
    call(make_event(payload=BELOW_THRESHOLD), billing, budgets)

    assert len(budgets.calls) == 1
    assert billing.update_calls == []
    assert billing.get_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_no_action"][0]
    assert entry["verification"] == "ok"


@pytest.mark.parametrize("error", [
    api_exceptions.ServiceUnavailable("503"),
    api_exceptions.DeadlineExceeded("timeout"),
    api_exceptions.PermissionDenied("denied"),
    api_exceptions.InternalServerError("500"),
])
def test_below_threshold_transient_verification_does_not_raise(call, billing, capsys, error):
    """A Budgets API blip must not start a 24-hour retry storm at $0.04 spend."""
    budgets = FakeBudgetClient(error=error)
    call(make_event(payload=BELOW_THRESHOLD), billing, budgets)

    assert billing.update_calls == []
    entry = [e for e in markers(capsys)
             if e["marker"] == "billing_shutdown_verification_unavailable"][0]
    assert entry["severity"] == "WARNING"
    assert entry["error_type"] == type(error).__name__


def test_below_threshold_verification_unavailable_is_not_an_error(call, billing, capsys):
    budgets = FakeBudgetClient(error=api_exceptions.ServiceUnavailable("503"))
    call(make_event(payload=BELOW_THRESHOLD), billing, budgets)

    entries = markers(capsys)
    assert not [e for e in entries if e["severity"] in ("ERROR", "CRITICAL")]
    assert "billing_shutdown_transient_failure" not in [e["marker"] for e in entries]


@pytest.mark.parametrize("client,reason", [
    (FakeBudgetClient(units="500"), "budget_amount_mismatch"),
    (FakeBudgetClient(threshold=0.5), "budget_threshold_rule_missing"),
    (FakeBudgetClient(error=api_exceptions.NotFound("gone")), "shutdown_budget_not_found"),
])
def test_below_threshold_configuration_mismatch_alerts_and_acknowledges(
        call, billing, capsys, client, reason):
    """The safeguard has been reconfigured — permanent, and a human must know."""
    call(make_event(payload=BELOW_THRESHOLD), billing, client)

    assert billing.update_calls == []
    entry = [e for e in markers(capsys)
             if e["marker"] == "billing_shutdown_configuration_error"][0]
    assert entry["reason"] == reason
    assert entry["severity"] == "ERROR"


def test_below_threshold_configuration_error_does_not_raise(call, billing):
    """Acknowledged, not retried: retrying cannot fix a reconfigured budget.

    handle() signals via PermanentReject; the entry point converts that into an
    acknowledgement, which is the behaviour that matters to Pub/Sub.
    """
    call(make_event(payload=BELOW_THRESHOLD), billing, FakeBudgetClient(units="500"))
    assert billing.update_calls == []


@pytest.mark.parametrize("error", [
    api_exceptions.ServiceUnavailable("503"),
    api_exceptions.DeadlineExceeded("timeout"),
    api_exceptions.PermissionDenied("denied"),
])
def test_at_threshold_verification_failure_raises(billing, capsys, error):
    with pytest.raises(type(error)):
        billing_main.handle(make_event(), billing, FakeBudgetClient(error=error))

    assert billing.update_calls == []
    names = [e["marker"] for e in markers(capsys)]
    assert "billing_shutdown_transient_failure" in names
    assert "billing_shutdown_verification_unavailable" not in names


def test_at_threshold_configuration_mismatch_blocks_and_acknowledges(call, billing, capsys):
    call(make_event(), billing, FakeBudgetClient(units="500"))

    assert billing.update_calls == []
    entry = [e for e in markers(capsys)
             if e["marker"] == "billing_shutdown_configuration_error"][0]
    assert entry["reason"] == "budget_amount_mismatch"


def test_threshold_below_shutdown_still_verifies(call, billing, budgets, capsys):
    call(make_event(payload={"costAmount": 95.0, "budgetAmount": 80.0,
                             "alertThresholdExceeded": 0.5}), billing, budgets)

    assert len(budgets.calls) == 1
    assert billing.update_calls == []
    entry = [e for e in markers(capsys) if e["marker"] == "billing_shutdown_no_action"][0]
    assert entry["reason"] == "threshold_below_shutdown"


def test_other_budget_still_skips_verification_entirely(call, billing, budgets, capsys):
    """The $100 budget must not cost a Budgets API call every 20 minutes."""
    event = make_event(attributes={"budgetId": OTHER_BUDGET_ID,
                                   "billingAccountId": TEST_BILLING_ACCOUNT,
                                   "schemaVersion": "1.0"})
    call(event, billing, budgets)

    assert budgets.calls == []
    assert billing.update_calls == []


def test_completed_path_still_verifies_resulting_state(call, budgets, capsys):
    client = FakeBillingClient(update_leaves_enabled=True)
    call(make_event(), client, budgets)

    entries = markers(capsys)
    assert "billing_shutdown_completed" not in [e["marker"] for e in entries]
    assert [e for e in entries if e["reason"] == "billing_still_enabled_after_update"]


def test_duplicate_delivery_still_safe_with_verification_enabled(call, billing, budgets):
    for _ in range(5):
        call(make_event(), billing, budgets)

    assert len(billing.update_calls) == 1
    assert billing.billing_enabled is False


def test_permanent_reject_never_raises_out_of_the_entry_point(billing, budgets):
    """Acknowledging is the point: redelivery could never help."""
    billing_main.stop_billing.__wrapped__(make_event(raw_data="!!!", payload=None))  # noqa


# --- result verification --------------------------------------------------

def test_update_that_leaves_billing_enabled_is_a_failure(call, budgets, capsys):
    client = FakeBillingClient(update_leaves_enabled=True)
    call(make_event(), client, budgets)

    # readouterr() drains the capture buffer, so read it exactly once.
    entries = markers(capsys)
    assert "billing_shutdown_completed" not in [e["marker"] for e in entries]
    entry = [e for e in entries if e["marker"] == "billing_shutdown_permanent_reject"][0]
    assert entry["reason"] == "billing_still_enabled_after_update"


# --- 24. the payload can never choose the project -------------------------

def test_payload_cannot_select_the_target_project(call, billing, budgets):
    event = make_event(payload={
        "costAmount": 95.0, "budgetAmount": 80.0, "alertThresholdExceeded": 1.0,
        "projectId": "some-other-project",
        "name": "projects/victim-project",
        "budgetDisplayName": "Test Shutdown Budget",
    })
    call(event, billing, budgets)

    assert billing.update_calls == [(f"projects/{TEST_PROJECT}", "")]
    assert billing.get_calls == [f"projects/{TEST_PROJECT}"]


def test_configuration_gaps_fail_closed(monkeypatch, billing, budgets, capsys):
    monkeypatch.setattr(billing_main, "SHUTDOWN_BUDGET_ID", "")

    try:
        billing_main.handle(make_event(), billing, budgets)
    except billing_main.PermanentReject as reject:
        assert reject.reason == "configuration_incomplete"
    else:
        pytest.fail("missing configuration must not be tolerated")

    assert billing.update_calls == []


# --- 25. no production disarm switch --------------------------------------

def test_source_has_no_production_simulation_switch():
    from pathlib import Path
    source = (Path(billing_main.__file__)).read_text()

    for forbidden in ["SIMULATE_DEACTIVATION", "DRY_RUN", "dry_run", "SIMULATE", "NOOP_MODE"]:
        assert forbidden not in source, f"{forbidden} must not ship in production code"


def test_no_secret_or_payload_logging_in_source():
    """Scan executable code only — the module comments legitimately say
    "never credentials", which is prose, not a leak."""
    import ast
    import io as _io
    import tokenize
    from pathlib import Path

    source = Path(billing_main.__file__).read_text()

    # Drop comments.
    stripped = []
    for token in tokenize.generate_tokens(_io.StringIO(source).readline):
        if token.type != tokenize.COMMENT:
            stripped.append(token)
    code = tokenize.untokenize(stripped)

    # Drop docstrings.
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef)):
            if (node.body and isinstance(node.body[0], ast.Expr)
                    and isinstance(node.body[0].value, ast.Constant)
                    and isinstance(node.body[0].value.value, str)):
                node.body.pop(0)
    executable = ast.unparse(tree)

    for forbidden in ["print(payload", "print(event", "json.dumps(payload",
                      "token", "credential", "password", "secret"]:
        assert forbidden not in executable, f"{forbidden} appears in executable code"

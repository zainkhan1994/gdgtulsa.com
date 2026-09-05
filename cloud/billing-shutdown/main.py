"""Detach billing from the GDG Tulsa project when the shutdown budget is hit.

This is the most destructive code path in the project, so every decision it
makes is derived from deployment configuration rather than from the incoming
message. The notification is treated as an untrusted trigger: it can say "look
again", it can never say "disable billing for project X".

Delivery is currently RETRY_POLICY_DO_NOT_RETRY. The exception semantics below
are written for the retrying world anyway, so enabling retries later is a
configuration change rather than a rewrite:

  permanent / input / security failure -> log, return, acknowledge, never mutate
  transient infrastructure failure     -> log, raise, let the platform redeliver
"""

import base64
import json
import math
import os

import functions_framework
from google.api_core import exceptions as api_exceptions
from google.cloud import billing_v1
from google.cloud.billing import budgets_v1

# Every one of these is supplied by Terraform from the resource it describes.
# Nothing here is derived from the message.
TARGET_PROJECT_ID = os.environ.get("TARGET_PROJECT_ID", "")
SHUTDOWN_BUDGET_ID = os.environ.get("SHUTDOWN_BUDGET_ID", "")
EXPECTED_BILLING_ACCOUNT_ID = os.environ.get("EXPECTED_BILLING_ACCOUNT_ID", "")
EXPECTED_BUDGET_UNITS = os.environ.get("EXPECTED_BUDGET_UNITS", "")

SUPPORTED_SCHEMA_VERSIONS = {"1.0"}

# Errors that mean "the platform was briefly unavailable", not "this request was
# wrong". PermissionDenied is deliberately included: IAM propagation can lag,
# and a missing permission must never quietly acknowledge a shutdown event.
TRANSIENT_ERRORS = (
    api_exceptions.ServiceUnavailable,
    api_exceptions.DeadlineExceeded,
    api_exceptions.Aborted,
    api_exceptions.InternalServerError,
    api_exceptions.TooManyRequests,
    api_exceptions.ResourceExhausted,
    api_exceptions.GatewayTimeout,
    api_exceptions.PermissionDenied,
    api_exceptions.Unauthenticated,
)


class PermanentReject(Exception):
    """The event can never succeed. Acknowledge it; do not retry it."""

    def __init__(self, reason, severity="ERROR",
                 marker="billing_shutdown_permanent_reject", **fields):
        super().__init__(reason)
        self.reason = reason
        self.severity = severity
        self.marker = marker
        self.fields = fields


class ConfigurationError(PermanentReject):
    """The safeguard itself is misconfigured. Never retry; always alert."""

    def __init__(self, reason, **fields):
        super().__init__(reason, severity="ERROR",
                         marker="billing_shutdown_configuration_error", **fields)


# Returned when the readiness check could not run but the project is nowhere
# near the threshold, so there is nothing to retry for yet.
VERIFICATION_UNAVAILABLE = "unavailable"
VERIFICATION_OK = "ok"


def log(severity, marker, **fields):
    """One structured line. Cloud Logging reads `severity` from stdout JSON.

    Only infrastructure identifiers are ever logged — never the raw payload,
    never credentials, never anything belonging to a person.
    """
    entry = {"severity": severity, "message": marker, "marker": marker}
    entry.update(fields)
    print(json.dumps(entry, sort_keys=True))


# ----------------------------------------------------------------- parsing


def parse_event(cloud_event):
    """Pull (attributes, payload) out of a Pub/Sub CloudEvent, trusting nothing."""
    data = getattr(cloud_event, "data", None)

    if not isinstance(data, dict):
        raise PermanentReject("cloudevent_data_missing")

    message = data.get("message")

    if not isinstance(message, dict):
        raise PermanentReject("pubsub_message_missing")

    attributes = message.get("attributes")

    if attributes is None:
        attributes = {}

    if not isinstance(attributes, dict):
        raise PermanentReject("attributes_invalid")

    encoded = message.get("data")

    if not isinstance(encoded, str) or not encoded:
        raise PermanentReject("message_data_missing")

    try:
        decoded = base64.b64decode(encoded, validate=True)
    except Exception:
        raise PermanentReject("base64_invalid")

    try:
        payload = json.loads(decoded.decode("utf-8"))
    except Exception:
        raise PermanentReject("json_invalid")

    if not isinstance(payload, dict):
        raise PermanentReject("json_not_object")

    return attributes, payload


def amount(payload, field):
    """A budget amount must be a real, finite, non-negative number."""
    value = payload.get(field)

    # bool is an int subclass; a boolean amount is malformed, not 0/1.
    if value is None or isinstance(value, bool):
        raise PermanentReject(f"{field}_invalid")

    if not isinstance(value, (int, float, str)):
        raise PermanentReject(f"{field}_invalid")

    try:
        number = float(value)
    except (TypeError, ValueError):
        raise PermanentReject(f"{field}_invalid")

    if not math.isfinite(number) or number < 0:
        raise PermanentReject(f"{field}_invalid")

    return number


def threshold_exceeded(payload):
    """alertThresholdExceeded is a fraction (1.0 == the 100% rule).

    Absent is allowed: schema 1.0 omits it on the informational updates that
    arrive between threshold crossings. Present but unusable is not allowed.
    """
    value = payload.get("alertThresholdExceeded")

    if value is None:
        return None

    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise PermanentReject("alert_threshold_invalid")

    try:
        number = float(value)
    except (TypeError, ValueError):
        raise PermanentReject("alert_threshold_invalid")

    if not math.isfinite(number) or number < 0:
        raise PermanentReject("alert_threshold_invalid")

    return number


# ------------------------------------------------------------ verification


def verify_budget_configuration(budget_client, at_threshold):
    """Re-read the budget from the API and confirm it is still the safeguard.

    This does NOT recompute spend — the Budgets API does not report accrued
    cost. It confirms the budget is configured the way the shutdown path
    requires, so a message describing a budget that no longer exists (or has
    been altered) cannot drive a shutdown.

    It runs on every shutdown-budget notification, not only at the threshold,
    so a broken Budgets API or a revoked permission is discovered during the
    routine traffic that arrives every twenty minutes rather than at the single
    moment the safeguard is needed.

    `at_threshold` decides how hard a temporary failure is treated:

      at threshold   -> the check is mandatory: log ERROR and raise, so the
                        event is retried once retries are enabled.
      below threshold-> the check is readiness only: log WARNING and carry on.
                        A Budgets API blip must not start a 24-hour retry storm
                        while spend is nowhere near the cap.

    A configuration MISMATCH is permanent at either level: it means the
    safeguard has been reconfigured, and no amount of retrying fixes that.
    """
    name = (
        f"billingAccounts/{EXPECTED_BILLING_ACCOUNT_ID}"
        f"/budgets/{SHUTDOWN_BUDGET_ID}"
    )

    try:
        budget = budget_client.get_budget(name=name)
    except TRANSIENT_ERRORS as error:
        if at_threshold:
            log(
                "ERROR",
                "billing_shutdown_transient_failure",
                stage="get_budget",
                error_type=type(error).__name__,
            )
            raise

        log(
            "WARNING",
            "billing_shutdown_verification_unavailable",
            stage="get_budget",
            error_type=type(error).__name__,
        )
        return VERIFICATION_UNAVAILABLE
    except (api_exceptions.NotFound, api_exceptions.InvalidArgument):
        # The pinned budget is gone or the name we built is unusable. Both mean
        # our configuration no longer matches reality: refuse, do not retry.
        raise ConfigurationError("shutdown_budget_not_found")

    units = str(getattr(budget.amount.specified_amount, "units", ""))

    if units != str(EXPECTED_BUDGET_UNITS):
        raise ConfigurationError("budget_amount_mismatch")

    has_shutdown_rule = any(
        float(getattr(rule, "threshold_percent", 0)) >= 1.0
        and rule.spend_basis == budgets_v1.ThresholdRule.Basis.CURRENT_SPEND
        for rule in budget.threshold_rules
    )

    if not has_shutdown_rule:
        raise ConfigurationError("budget_threshold_rule_missing")

    return VERIFICATION_OK


# ---------------------------------------------------------------- handling


def handle(cloud_event, billing_client, budget_client):
    """Decide and, only if every check passes, detach billing."""
    if not (
        TARGET_PROJECT_ID
        and SHUTDOWN_BUDGET_ID
        and EXPECTED_BILLING_ACCOUNT_ID
        and EXPECTED_BUDGET_UNITS
    ):
        # Fail loudly rather than fall back to a guessable default.
        raise PermanentReject("configuration_incomplete")

    project_name = f"projects/{TARGET_PROJECT_ID}"

    attributes, payload = parse_event(cloud_event)

    budget_id = attributes.get("budgetId")

    if not budget_id:
        # Not a routine "different budget" — it means this delivery does not
        # look like a Cloud Billing notification at all. The attribute NAMES
        # (never their values) are what make that diagnosable, and they are the
        # only evidence available: Pub/Sub attributes appear in no other log.
        raise PermanentReject(
            "budget_id_attribute_missing",
            attribute_keys=",".join(sorted(attributes)) or "(none)",
        )

    if budget_id != SHUTDOWN_BUDGET_ID:
        # Expected and frequent: the $100 budget publishes to the same topic.
        log(
            "INFO",
            "billing_shutdown_event_ignored",
            budget_id=budget_id,
            reason="not_shutdown_budget",
        )
        return

    if attributes.get("billingAccountId") != EXPECTED_BILLING_ACCOUNT_ID:
        raise PermanentReject("billing_account_mismatch")

    schema_version = attributes.get("schemaVersion")

    if schema_version is not None and schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        raise PermanentReject("schema_version_unsupported")

    cost = amount(payload, "costAmount")
    limit = amount(payload, "budgetAmount")
    exceeded = threshold_exceeded(payload)

    below_threshold_reason = None

    if exceeded is not None and exceeded < 1.0:
        below_threshold_reason = "threshold_below_shutdown"
    elif cost < limit:
        below_threshold_reason = "cost_below_budget"

    at_threshold = below_threshold_reason is None

    # Runs either way: below the threshold it is a readiness check that keeps
    # the critical dependency exercised; at the threshold it is mandatory.
    verification = verify_budget_configuration(budget_client, at_threshold)

    if not at_threshold:
        if verification == VERIFICATION_UNAVAILABLE:
            # Already logged at WARNING. Nothing to retry: spend is below cap.
            return

        log(
            "INFO",
            "billing_shutdown_no_action",
            budget_id=budget_id,
            reason=below_threshold_reason,
            verification=verification,
        )
        return

    try:
        current = billing_client.get_project_billing_info(name=project_name)
    except TRANSIENT_ERRORS as error:
        log(
            "ERROR",
            "billing_shutdown_transient_failure",
            stage="get_project_billing_info",
            error_type=type(error).__name__,
        )
        raise

    if not current.billing_enabled:
        # Replay, duplicate delivery, or a shutdown that already happened.
        log(
            "INFO",
            "billing_shutdown_noop_already_disabled",
            project_id=TARGET_PROJECT_ID,
        )
        return

    try:
        result = billing_client.update_project_billing_info(
            name=project_name,
            project_billing_info=billing_v1.ProjectBillingInfo(
                billing_account_name=""
            ),
        )
    except TRANSIENT_ERRORS as error:
        log(
            "ERROR",
            "billing_shutdown_transient_failure",
            stage="update_project_billing_info",
            error_type=type(error).__name__,
        )
        raise

    # Never report success on the strength of the call not raising.
    if result.billing_enabled or result.billing_account_name:
        raise PermanentReject("billing_still_enabled_after_update")

    # Deliberately not an error severity: the safeguard worked. A dedicated
    # log-based metric matches this marker, so alerting does not depend on
    # dressing success up as a failure.
    log(
        "INFO",
        "billing_shutdown_completed",
        project_id=TARGET_PROJECT_ID,
        budget_id=budget_id,
    )


@functions_framework.cloud_event
def stop_billing(cloud_event):
    try:
        handle(cloud_event, billing_v1.CloudBillingClient(), budgets_v1.BudgetServiceClient())
    except PermanentReject as reject:
        # Acknowledged on purpose: redelivering this event can never help.
        log(
            reject.severity,
            reject.marker,
            reason=reject.reason,
            **reject.fields,
        )

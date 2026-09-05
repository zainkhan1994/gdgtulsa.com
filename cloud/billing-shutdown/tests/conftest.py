"""Test bootstrap for the billing-shutdown function.

Nothing in this directory may reach Google. Both cloud clients are replaced
with fakes that record calls, and the module's configuration is supplied from
the environment before import so no test depends on a live deployment.
"""

import base64
import json
import os
import sys
import types
from pathlib import Path

import pytest

FUNCTION_DIR = Path(__file__).resolve().parents[1]

# Deliberately not the production values, so a test can never be mistaken for
# a real event and a copied fixture can never address the real project.
TEST_PROJECT = "test-project"
TEST_BUDGET_ID = "11111111-2222-3333-4444-555555555555"
OTHER_BUDGET_ID = "99999999-8888-7777-6666-555555555555"
TEST_BILLING_ACCOUNT = "TEST00-000000-000000"
TEST_UNITS = "80"

os.environ.update(
    TARGET_PROJECT_ID=TEST_PROJECT,
    SHUTDOWN_BUDGET_ID=TEST_BUDGET_ID,
    EXPECTED_BILLING_ACCOUNT_ID=TEST_BILLING_ACCOUNT,
    EXPECTED_BUDGET_UNITS=TEST_UNITS,
)

sys.path.insert(0, str(FUNCTION_DIR))

import main as billing_main  # noqa: E402

from google.cloud import billing_v1  # noqa: E402
from google.cloud.billing import budgets_v1  # noqa: E402


class FakeBillingClient:
    """Mimics CloudBillingClient, including its set-to-state semantics."""

    def __init__(self, billing_enabled=True, get_error=None, update_error=None,
                 update_leaves_enabled=False):
        self.billing_enabled = billing_enabled
        self.get_error = get_error
        self.update_error = update_error
        self.update_leaves_enabled = update_leaves_enabled
        self.get_calls = []
        self.update_calls = []

    def _info(self, name, enabled):
        return billing_v1.ProjectBillingInfo(
            name=name,
            billing_enabled=enabled,
            billing_account_name=f"billingAccounts/{TEST_BILLING_ACCOUNT}" if enabled else "",
        )

    def get_project_billing_info(self, name):
        self.get_calls.append(name)
        if self.get_error:
            raise self.get_error
        return self._info(name, self.billing_enabled)

    def update_project_billing_info(self, name, project_billing_info):
        self.update_calls.append((name, project_billing_info.billing_account_name))
        if self.update_error:
            raise self.update_error
        # Unlink is idempotent: setting it again lands on the same state.
        if project_billing_info.billing_account_name == "":
            self.billing_enabled = self.update_leaves_enabled
        return self._info(name, self.update_leaves_enabled)


class FakeBudgetClient:
    def __init__(self, units=TEST_UNITS, threshold=1.0,
                 basis=budgets_v1.ThresholdRule.Basis.CURRENT_SPEND, error=None):
        self.units = units
        self.threshold = threshold
        self.basis = basis
        self.error = error
        self.calls = []

    def get_budget(self, name):
        self.calls.append(name)
        if self.error:
            raise self.error
        rules = []
        if self.threshold is not None:
            rules.append(budgets_v1.ThresholdRule(
                threshold_percent=self.threshold, spend_basis=self.basis))
        return budgets_v1.Budget(
            name=name,
            display_name="Test Shutdown Budget",
            amount=budgets_v1.BudgetAmount(
                specified_amount={"currency_code": "USD", "units": int(self.units)}),
            threshold_rules=rules,
        )


def make_event(payload=None, attributes=None, raw_data=None, message="default",
               event_id="evt-1", message_id="msg-1"):
    """Build a Pub/Sub CloudEvent the way Eventarc delivers one."""
    if payload is None:
        payload = {
            "budgetDisplayName": "Test Shutdown Budget",
            "costAmount": 95.0,
            "budgetAmount": 80.0,
            "alertThresholdExceeded": 1.0,
            "currencyCode": "USD",
        }

    if attributes is None:
        attributes = {
            "budgetId": TEST_BUDGET_ID,
            "billingAccountId": TEST_BILLING_ACCOUNT,
            "schemaVersion": "1.0",
        }

    if raw_data is None and payload is not None:
        raw_data = base64.b64encode(json.dumps(payload).encode()).decode()

    if message == "default":
        message = {"data": raw_data, "attributes": attributes, "messageId": message_id}

    return types.SimpleNamespace(
        data=None if message is None else {"message": message},
        id=event_id,
    )


def markers(capsys):
    """Structured log lines emitted during the call."""
    out = []
    for line in capsys.readouterr().out.splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def marker_names(capsys):
    return [entry["marker"] for entry in markers(capsys)]


@pytest.fixture
def billing():
    return FakeBillingClient()


@pytest.fixture
def budgets():
    return FakeBudgetClient()


@pytest.fixture
def call():
    """Invoke the handler exactly as the entry point does, exceptions and all."""
    def _call(event, billing_client, budget_client):
        try:
            billing_main.handle(event, billing_client, budget_client)
        except billing_main.PermanentReject as reject:
            billing_main.log(
                reject.severity, "billing_shutdown_permanent_reject",
                reason=reject.reason, **reject.fields)
        return None
    return _call

import base64
import json
import os

import functions_framework
from google.cloud import billing_v1
from google.cloud import logging

PROJECT_ID = "gdg-tulsa"
PROJECT_NAME = f"projects/{PROJECT_ID}"
TARGET_BUDGET = "GDG Tulsa $80 Shutdown Budget"
SIMULATE_DEACTIVATION = False

billing_client = billing_v1.CloudBillingClient()


@functions_framework.cloud_event
def stop_billing(cloud_event):
    data = cloud_event.data["message"]["data"]
    event = json.loads(base64.b64decode(data).decode("utf-8"))

    budget_name = event.get("budgetDisplayName")
    cost = float(event.get("costAmount", 0))
    budget = float(event.get("budgetAmount", 0))

    print(f"Budget: {budget_name}, Cost: ${cost}, Limit: ${budget}")

    # Ignore the separate $100 alert budget
    if budget_name != TARGET_BUDGET:
        print("Ignoring notification from another budget.")
        return

    if cost < budget:
        print("No action required.")
        return

    if SIMULATE_DEACTIVATION:
        print("SIMULATION: Billing would now be disabled.")
        return

    info = billing_v1.ProjectBillingInfo(billing_account_name="")

    billing_client.update_project_billing_info(
        name=PROJECT_NAME,
        project_billing_info=info,
    )

    print("Billing disabled.")

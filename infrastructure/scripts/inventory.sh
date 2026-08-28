#!/usr/bin/env bash
# Phase 2 — production inventory.
#
# READ-ONLY. Every command below is a describe/list/get. Nothing here creates,
# modifies, deletes or triggers anything. Safe to run against production.
#
# Purpose: capture the EXACT current configuration so Terraform can be written
# to match reality rather than to match a handoff document.
#
# Usage:  ./inventory.sh > inventory-$(date +%F).txt 2>&1

set -uo pipefail

PROJECT="gdg-tulsa"
PROJECT_NUMBER="867531953739"
REGION="us-central1"
BILLING="01A239-502350-6B64D0"

hdr() { printf '\n\n========== %s ==========\n' "$1"; }

hdr "IDENTITY / CONTEXT"
gcloud config list 2>&1
gcloud auth list 2>&1

hdr "PROJECT"
gcloud projects describe "$PROJECT" --format=json 2>&1

hdr "ENABLED SERVICES"
gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' 2>&1 | sort

hdr "BIGQUERY DATASET"
bq --project_id="$PROJECT" show --format=prettyjson "${PROJECT}:website_analytics" 2>&1

hdr "BIGQUERY TABLE (schema, partitioning, clustering)"
bq --project_id="$PROJECT" show --format=prettyjson "${PROJECT}:website_analytics.events" 2>&1

hdr "BIGQUERY ROW COUNT + RECENT ACTIVITY"
bq --project_id="$PROJECT" query --use_legacy_sql=false --format=prettyjson \
  'SELECT COUNT(*) AS total_rows,
          MIN(event_timestamp) AS earliest,
          MAX(event_timestamp) AS latest,
          COUNT(DISTINCT anonymous_id) AS visitors
   FROM `gdg-tulsa.website_analytics.events`' 2>&1

hdr "PUB/SUB TOPIC"
gcloud pubsub topics describe billing-alerts-topic --project="$PROJECT" --format=json 2>&1
gcloud pubsub topics list-subscriptions billing-alerts-topic --project="$PROJECT" 2>&1

hdr "SERVICE ACCOUNTS"
gcloud iam service-accounts list --project="$PROJECT" --format=json 2>&1

hdr "PROJECT IAM POLICY (full — needed before any IAM Terraform)"
gcloud projects get-iam-policy "$PROJECT" --format=json 2>&1

hdr "SECRET MANAGER (metadata only — never the value)"
gcloud secrets describe ip-hash-secret --project="$PROJECT" --format=json 2>&1
gcloud secrets versions list ip-hash-secret --project="$PROJECT" --format=json 2>&1
gcloud secrets get-iam-policy ip-hash-secret --project="$PROJECT" --format=json 2>&1

hdr "CLOUD RUN SERVICE"
gcloud run services describe gdg-tulsa-collector \
  --region="$REGION" --project="$PROJECT" --format=json 2>&1

hdr "CLOUD RUN IAM (public invoker check)"
gcloud run services get-iam-policy gdg-tulsa-collector \
  --region="$REGION" --project="$PROJECT" --format=json 2>&1

hdr "CLOUD RUN REVISIONS"
gcloud run revisions list --service=gdg-tulsa-collector \
  --region="$REGION" --project="$PROJECT" --format=json 2>&1

hdr "CLOUD FUNCTION (gen2) — billing-shutdown"
gcloud functions describe billing-shutdown \
  --gen2 --region="$REGION" --project="$PROJECT" --format=json 2>&1

hdr "EVENTARC TRIGGERS"
gcloud eventarc triggers list --location="$REGION" --project="$PROJECT" --format=json 2>&1

hdr "BUDGETS"
gcloud billing budgets list --billing-account="$BILLING" --format=json 2>&1

hdr "BILLING LINK (read-only confirmation)"
gcloud billing projects describe "$PROJECT" --format=json 2>&1

hdr "ARTIFACT REGISTRY (Cloud Run / Functions images)"
gcloud artifacts repositories list --project="$PROJECT" --format=json 2>&1

hdr "ORG POLICY — domain restricted sharing (project override)"
gcloud resource-manager org-policies describe iam.allowedPolicyMemberDomains \
  --project="$PROJECT" --format=json 2>&1

hdr "ORG POLICY — service account key creation (must stay enforced)"
gcloud resource-manager org-policies describe iam.disableServiceAccountKeyCreation \
  --organization=956552594595 --format=json 2>&1

hdr "GCS BUCKETS (checking whether a state bucket already exists)"
gcloud storage buckets list --project="$PROJECT" --format=json 2>&1

hdr "DONE"

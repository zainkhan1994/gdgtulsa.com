# GDG Tulsa — Infrastructure as Code

Terraform configuration describing the **existing production** Google Cloud
infrastructure behind the GDG Tulsa website analytics platform.

> **This describes a live system.** Every resource here already exists and is
> serving production traffic. Nothing in this directory should ever create a
> resource from scratch — resources are **imported**. Read the safety rules
> before running anything.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Terraform skeleton, provider pinning, API config | **Done** |
| 2 | Production inventory | **Blocked — needs GCP auth** |
| 3 | Import BigQuery, Pub/Sub, Secret, service accounts | Not started |
| 4 | IAM (non-authoritative bindings only) | Not started |
| 5 | Budgets | Not started |
| 6 | Cloud Run (infrastructure only) | Not started |
| 7 | Billing shutdown function | Not started |
| 8 | Remote state in private GCS | Not started |
| 9 | Full documentation | Not started |

## Architecture

```
Visitor browser
  └─ consent.js  (opt-in gate; tracking runs only when consent == "granted")
  └─ tracker.js  (page_view + click, sendBeacon for navigation)
        │  HTTPS, origin-restricted
        ▼
  Cloud Run: gdg-tulsa-collector        (us-central1, public, min=0 max=1)
        │  validates origin/consent/size, filters bots,
        │  HMACs the IP with Secret Manager, stores no raw IP
        ▼
  BigQuery: website_analytics.events    (DAY partitioned, clustered)

Billing Budget ($80)
        └─ Pub/Sub: billing-alerts-topic
              └─ Cloud Function (gen2): billing-shutdown
                    └─ detaches the project billing account
```

## Hard rules

These are not style preferences. Breaking them can take production down or
cost money.

1. **Never `terraform destroy`.** Not on any workspace, ever.
2. **Never let Terraform manage the billing-account attachment.** The shutdown
   function detaches billing deliberately at $80. Terraform would fight it and
   could silently re-attach billing after an emergency cut-off.
3. **Never create service-account JSON keys.** `iam.disableServiceAccountKeyCreation`
   is enforced org-wide and must stay that way. Use workload identity.
4. **Never put the secret value in Terraform.** The `ip-hash-secret` *resource*
   may be managed; its *value* must not be read, written, or referenced.
5. **Never trigger the $80 shutdown function** for testing. It is live —
   `SIMULATE_DEACTIVATION = False` in `cloud/billing-shutdown/main.py`.
6. **Reject any plan** containing an unexpected destroy, replace or recreate on
   a production resource. Investigate before proceeding.
7. **Prefer non-authoritative IAM.** Use `google_*_iam_member`, never
   `google_*_iam_policy` or `_binding`, which silently remove members you did
   not enumerate.

## Application code is not here

Terraform describes infrastructure only.

| What | Where |
|---|---|
| Collector application | `cloud/collector/` |
| Billing shutdown function | `cloud/billing-shutdown/` |
| Website and tracking scripts | repository root |
| Infrastructure | `infrastructure/` (this directory) |

Deployment of application source stays with `gcloud`/CI. Terraform manages the
Cloud Run *service configuration*, not the container build — coupling Terraform
to source builds would mean every code change requires a Terraform run.

## Running it

```bash
cd infrastructure
terraform init
terraform fmt -check
terraform validate
terraform plan          # review every line before acting
```

After importing, a correct plan reads **0 to add, 0 to change, 0 to destroy**.
Anything else must be explained before it is applied.

### Phase 2 — inventory first

Terraform must be written to match production, not this document. Run:

```bash
./scripts/inventory.sh > inventory-$(date +%F).txt 2>&1
```

It is strictly read-only — describe/list/get only, no mutating verbs.
Its output is git-ignored because it contains the full IAM policy.

## State

State is **local and git-ignored** until imports are stable. Phase 8 moves it
to a private, versioned GCS bucket with uniform bucket-level access and public
access prevention.

State contains resource metadata and must never be committed.

## Reproducing this environment

Not currently possible from Terraform alone, and that is intentional for now —
the configuration describes existing resources rather than defining them from
zero. Once Phases 3–7 are imported and the plan is clean, this directory
becomes the source of truth and a rebuild becomes feasible. Disaster-recovery
steps are documented in Phase 9.

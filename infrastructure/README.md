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
| 2 | Production inventory | Complete |
| 3 | Import BigQuery, Pub/Sub, Secret, service accounts | Complete |
| 4 | IAM (non-authoritative bindings only) | Complete |
| 5 | Budgets | Complete |
| 6 | Cloud Run (infrastructure only) | Complete |
| 7 | Billing shutdown function | Complete |
| 8 | Remote state in private GCS | Complete |
| 9 | Full documentation | In progress |

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

## Terraform state

Terraform state is stored remotely in the private GCS bucket:

`gs://gdg-tulsa-terraform-state-867531953739/terraform/state/default.tfstate`

The state bucket is configured with:

- Uniform bucket-level access
- Public access prevention enforced
- Object versioning enabled

The bucket is bootstrap infrastructure and is intentionally not managed by the
Terraform state stored inside it.

Local Terraform state files are git-ignored and must never be committed.

## Current managed resources

Stages 1 through 7 are complete. Terraform state contains **17 resources**, and
the post-import plan reports:

`No changes. Your infrastructure matches the configuration.`

### Storage and identity

- BigQuery dataset `website_analytics`
- BigQuery table `website_analytics.events`
- Pub/Sub topic `billing-alerts-topic`
- Secret Manager container `ip-hash-secret` (container only — never the value)
- Service account `gdg-tulsa@gdg-tulsa.iam.gserviceaccount.com`
- Service account `billing-shutdown@gdg-tulsa.iam.gserviceaccount.com`

### IAM — all non-authoritative (`_iam_member`)

- `roles/bigquery.dataEditor` and `roles/bigquery.jobUser` for the collector
- `roles/secretmanager.secretAccessor` on `ip-hash-secret`, scoped to that one
  secret rather than granted project-wide
- `roles/billing.projectManager` for the shutdown account
- `roles/billing.admin` on the billing account for the shutdown account

No authoritative IAM resource (`_iam_policy` / `_iam_binding`) exists anywhere
in this configuration. Those would silently remove any principal not listed
here, which on this project would strip Google's service agents and break
Cloud Build, Eventarc, Cloud Run and Pub/Sub.

### Budgets

- `GDG Tulsa $80 Shutdown Budget` — drives the live shutdown function
- `GDG Tulsa $100 Budget` — warning thresholds only

Both use `EXCLUDE_ALL_CREDITS`, so they measure gross usage and the $80 fires
ahead of the $100 rather than after the promotional credit is exhausted.

### Compute

- `google_cloud_run_v2_service.collector` — the analytics collector
- `google_cloud_run_v2_service_iam_member.collector_public_invoker` —
  `allUsers` → `roles/run.invoker`, the binding that makes the collector
  publicly reachable
- `google_cloudfunctions2_function.billing_shutdown` — the Gen2 function
- `google_cloud_run_v2_service_iam_member.billing_shutdown_invoker` —
  the shutdown service account → `roles/run.invoker` on the function's
  underlying Cloud Run service

## Ownership boundaries

The most important thing to understand before editing anything here: Terraform
owns **runtime configuration**, not the deployment pipeline.

### Cloud Run collector

Actively managed: container image, runtime service account, the
`IP_HASH_SECRET` reference, CPU and memory limits, `cpu_idle`,
`startup_cpu_boost`, request concurrency, timeout, revision-level
`max_instance_count`, ingress and traffic.

Preserved but deliberately not owned, via a narrowly scoped
`lifecycle.ignore_changes`:

| Field | Why it is not owned |
|---|---|
| `client`, `client_version` | Arbitrary deploy-tool identifiers (`gcloud`, `581.0.0`). Owning them would make every gcloud version bump show as drift forever. |
| `build_config` | The source-build pipeline — `base_image`, `image_uri`, `source_location`, build id. Owning it risks Terraform triggering builds and couples infrastructure to the application deploy path. |
| `scaling` (service level) | `manual_instance_count` / `min_instance_count` / `scaling_mode`. Declaring these could flip the service between automatic and manual scaling. |

These four are ignored because they are **explained**, not because they are
inconvenient: all four are `optional` and none are `computed` in provider
6.50.0, so leaving them undeclared would make Terraform propose deleting live
configuration. `ignore_changes` must never be used here to bury a difference
nobody has understood.

The service-level annotation still reads `run.googleapis.com/maxScale = 20`
from an older deploy, while the active revision uses
`autoscaling.knative.dev/maxScale = 1`. The revision governs actual scaling,
so `template.scaling.max_instance_count = 1` is what Terraform manages — and
**`template` scaling is not ignored**, only the top-level `scaling` block.

### Billing shutdown function

Terraform manages the Gen2 function and its `event_trigger` block. The
Eventarc trigger is generated and owned by Cloud Functions; it is represented
only through `event_trigger` and never as a standalone
`google_eventarc_trigger`. The generated Pub/Sub subscription
(`eventarc-us-central1-billing-shutdown-997704-sub-682`) stays Google-managed.

`service_config.environment_variables` explicitly declares
`LOG_EXECUTION_ID = "true"` to match live. That field is `optional` but **not
`computed`**, so omitting it would make Terraform propose removing the
variable and redeploy the armed safeguard.

The function source generation is pinned to the currently deployed artifact.
If the function is redeployed out of band the generation changes and the plan
will show it — that is the intended signal, not drift to suppress.

## Intentionally unmanaged

- Generated Eventarc trigger as a standalone resource
- Generated Eventarc Pub/Sub subscription
- Google service agents and the two `cloudbuild.builds.builder` defaults
- `roles/owner` for the human administrator
- Function source GCS bucket and object; the Cloud Run source bucket
- Artifact Registry repositories (`gcf-artifacts`, `cloud-run-source-deploy`)
- Domain Restricted Sharing policy override (security debt — review pending)
- Project billing-account attachment (see Hard rules)
- Project API enablement
- The billing-account-wide `$100 Monthly Budget Alert`, which predates this
  project

## Production verification

Confirmed after the Stage 3 import:

- `gdg-tulsa-collector` `/health` → `HTTP 200 {"status":"ok"}`
- `billing-shutdown` Gen2 function state → `ACTIVE`
- Project `billingEnabled` → `true`

## Provider and authentication notes

Two prerequisites are easy to lose and expensive to rediscover:

**`cloudresourcemanager.googleapis.com` must be enabled.** It was enabled
manually and is required for Terraform to read project IAM. Without it, IAM
plans fail with a permissions error that does not name the missing API.

**`providers.tf` sets `billing_project` and `user_project_override = true`.**
This routes quota to `gdg-tulsa` when authenticating with user ADC rather than
a service account. Removing either line breaks `terraform plan` for anyone
running under `gcloud auth application-default login`.

## Reproducing this environment

Stages 1–7 are imported and the plan is clean, so this directory is now the
source of truth for the resources it declares. A rebuild from zero is still
not a single `terraform apply`, and that is expected:

- The Cloud Run image and the function source archive are built and published
  by `gcloud`/CI, not by Terraform. A rebuild needs those artifacts to exist
  first.
- The state bucket is bootstrap infrastructure and is deliberately not managed
  by the state stored inside it, so it must be created before `init`.
- Google-managed resources listed under *Intentionally unmanaged* are recreated
  automatically by their own services and should not be provisioned by hand.

For disaster recovery the practical order is: create the project and link
billing, enable the APIs, create the state bucket, deploy the application
source with `gcloud` so the images exist, then `terraform init` and import.

# Infrastructure

Terraform-only infrastructure lives under `terraform/`. Keep deployable Terraform modules in `terraform/modules/` and environment composition in `terraform/envs/`.

Policy files that are consumed by application or cloud configuration live in `infra/policies/`. Application source and deployment scripts do not belong in this directory.

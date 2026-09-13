variable "project_id" {
  description = "Google Cloud project ID hosting the analytics platform."
  type        = string
  default     = "gdg-tulsa"
}

variable "project_number" {
  description = "Project number, needed for service agent and IAM member strings."
  type        = string
  default     = "867531953739"
}

variable "region" {
  description = "Region for Cloud Run, Cloud Functions and Eventarc."
  type        = string
  default     = "us-central1"
}

variable "billing_account" {
  description = <<-EOT
    Billing account ID, used only for budget resources.

    The project's billing-account ATTACHMENT is deliberately not managed by
    Terraform: the billing-shutdown function detaches it on purpose when the
    $80 threshold is reached, and Terraform would fight that safety mechanism.
  EOT
  type        = string
  default     = "01A239-502350-6B64D0"
}

variable "org_id" {
  description = "Organization ID (thekhanstruct.com)."
  type        = string
  default     = "956552594595"
}

variable "monitoring_notification_email" {
  description = <<-EOT
    Destination for operational alert notifications.

    Deliberately has no default: the address is personal and must not be
    committed. Supply it at plan/apply time, e.g.

      export TF_VAR_monitoring_notification_email="ops@example.com"
  EOT
  type        = string
  sensitive   = true
}


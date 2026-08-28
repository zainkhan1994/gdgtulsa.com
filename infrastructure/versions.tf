# Terraform and provider version pinning.
#
# This configuration describes EXISTING production infrastructure for the
# GDG Tulsa analytics platform. Resources are imported, never created from
# scratch — see README.md for the import procedure.

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.12"
    }
  }

  backend "gcs" {
    bucket = "gdg-tulsa-terraform-state-867531953739"
    prefix = "terraform/state"
  }
}

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

  # State backend is configured in Phase 8, after imports are stable.
  # Until then state is local and git-ignored. See README.md.
}

---
id: ADR-0001
title: Configurable Container Registry with Google Cloud OIDC Authentication
status: Accepted
date: 2026-02-05
deciders: [jmmaloney4]
consulted: []
tags: [design, adr, nix, docker, gcp, authentication]
supersedes: []
superseded_by: []
links: []
---

# Context

The nix.yml workflow currently hard-codes `ghcr.io` as the container registry and uses GitHub token-based authentication. This limits the ability to push container images to other registries such as Google Artifact Registry (GAR) or Google Container Registry (GCR) which are commonly used in production environments.

Key constraints and forces:
- Need to support multiple container registries (ghcr.io, gcr.io, us-docker.pkg.dev, etc.)
- Google Cloud registries require OIDC authentication via Workload Identity Federation
- Must maintain backwards compatibility with existing workflows using GHCR
- Authentication mechanisms differ between registries (username/password vs OAuth2 tokens)
- Want to avoid duplicating GCP authentication logic across multiple workflows (nix, pulumi)

**In scope:**
- Making registry configurable in nix.yml workflow
- Adding Google Cloud OIDC authentication support
- Creating reusable GCP authentication composite action
- Supporting both GHCR (existing) and GCR/GAR (new) authentication methods

**Out of scope:**
- Supporting other cloud providers (AWS ECR, Azure ACR) in this ADR
- Refactoring pulumi.yml to use the new gcp-auth action (future work)
- Multi-registry push (pushing same image to multiple registries simultaneously)

# Decision

We MUST add a configurable `registry` input to the nix.yml workflow with a default value of `ghcr.io` to maintain backwards compatibility.

We MUST create a new composite action `.github/actions/gcp-auth/` that encapsulates Google Cloud OIDC authentication logic. This action:
- MUST accept `workload_identity_provider` and `service_account_email` as required inputs
- MUST validate that both inputs are provided together
- MUST use `google-github-actions/auth@v3` with pinned SHA for OIDC authentication
- MUST optionally install gcloud CLI via `google-github-actions/setup-gcloud@v3`
- MUST verify authentication succeeded by testing `gcloud auth print-access-token`
- MUST fail fast with clear error messages if authentication fails

The push-nix-image.yml workflow MUST accept optional `google_workload_identity_provider` and `google_service_account_email` inputs. When these are provided, it MUST:
- Call the gcp-auth action before building/pushing images
- Pass a `use-gcp-auth` flag to the push-nix-image composite action
- Ensure `id-token: write` permission is available for OIDC

The push-nix-image composite action MUST detect the authentication method at runtime:
- When `use-gcp-auth` is true: use `gcloud auth print-access-token` to obtain OAuth2 token and authenticate with username `oauth2accesstoken`
- When `use-gcp-auth` is false: use traditional username/password authentication
- MUST fail fast if gcloud is not available when GCP auth is requested

All new inputs MUST be optional to maintain full backwards compatibility.

# Consequences

## Positive
- Enables pushing container images to Google Artifact Registry and Google Container Registry
- Centralizes GCP OIDC authentication logic in a reusable composite action
- Maintains 100% backwards compatibility with existing workflows
- Follows security best practices (OIDC over long-lived credentials)
- Enables future workflows to easily add GCP authentication
- Registry-agnostic design supports any OCI-compliant registry

## Negative
- Adds complexity to the authentication flow with conditional logic
- Requires proper GCP Workload Identity Federation setup as a prerequisite
- Testing requires actual GCP credentials (cannot be fully mocked locally)
- Slight increase in workflow execution time when GCP auth is used
- Additional maintenance burden for the new gcp-auth composite action

# Alternatives

## Option A: Embedded Authentication (Rejected)
Keep GCP authentication logic directly in push-nix-image.yml without extracting to a separate action.

**Pros:**
- Simpler data flow, fewer files
- Matches existing pattern in pulumi.yml

**Cons:**
- Duplicates authentication logic across workflows
- Harder to maintain consistency
- More difficult to add GCP auth to future workflows

**Rejected because:** The team prioritized reusability and maintainability over simplicity.

## Option B: Separate Reusable Workflow (Rejected)
Create a separate reusable workflow (workflow_call) for GCP authentication.

**Pros:**
- Maximum abstraction and reusability

**Cons:**
- GitHub Actions doesn't easily share authenticated state between chained workflow_call invocations
- More complex job dependencies
- Harder to debug

**Rejected because:** Composite actions are better suited for this use case than workflow_call chaining.

## Option C: Support Only One Auth Method (Rejected)
Force all workflows to use GCP OIDC exclusively, removing username/password support.

**Pros:**
- Simpler implementation, single code path

**Cons:**
- Breaks all existing workflows using GHCR
- Forces GCP dependency on all users

**Rejected because:** Backwards compatibility is a hard requirement.

# Security / Privacy / Compliance

- **OIDC tokens:** Short-lived tokens obtained via OIDC are more secure than long-lived PATs
- **Credential exposure:** Credentials are passed through environment variables and never logged
- **Permissions:** Requires `id-token: write` permission which is already present in nix.yml
- **Service account:** Requires proper IAM configuration with principle of least privilege (Artifact Registry Writer role only)
- **Audit:** GCP Cloud Audit Logs will capture all image push operations with service account identity
- **Secrets:** No new secrets required for GCP auth (uses OIDC); existing GITHUB_TOKEN continues to work for GHCR

# Operational Notes

- **Observability:** Failed authentication will produce clear error messages in workflow logs
- **Cost:** No additional cost; OIDC authentication is free, registry storage costs unchanged
- **Quotas:** Subject to Google Cloud quotas for Artifact Registry API calls
- **Runbooks:** If GCP auth fails, verify Workload Identity Federation configuration and service account permissions
- **Rollout:** Feature is opt-in; existing workflows continue unchanged
- **Backout:** Remove GCP-specific inputs from workflow calls; workflows will fall back to GHCR

# Status Transitions

This is the first ADR in the repository. Status set to Accepted upon implementation completion.

# Implementation Notes

Implementation will proceed in discrete steps, with commits after each:
1. Create `.github/actions/gcp-auth/action.yml` composite action
2. Update `.github/workflows/nix.yml` to add registry and GCP inputs
3. Update `.github/workflows/push-nix-image.yml` to support GCP authentication
4. Update `.github/actions/push-nix-image/` to detect and use appropriate auth method

Each step will be committed separately for clean git history and easier review.

**Testing strategy:**
- Verify existing GHCR workflows continue to work unchanged
- Test with Google Artifact Registry using real GCP credentials
- Test with legacy GCR (gcr.io)
- Test validation (incomplete GCP inputs should fail fast)
- Test error handling (missing gcloud should produce clear error)

**Future work:**
- Consider refactoring pulumi.yml to use the new gcp-auth action
- Consider adding support for AWS ECR and Azure ACR
- Add comprehensive documentation with setup examples

# References

- Google GitHub Actions Auth: https://github.com/google-github-actions/auth
- Workload Identity Federation: https://cloud.google.com/iam/docs/workload-identity-federation
- GitHub OIDC: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
- Skopeo documentation: https://github.com/containers/skopeo

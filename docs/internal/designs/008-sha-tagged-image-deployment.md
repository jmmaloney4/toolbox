---
id: ADR-008
title: SHA-Tagged Container Image CI/CD with Build→Deploy Coordination
status: Proposed
date: 2026-01-11
deciders: [jack]
consulted: []
tags: [ci-cd, github-actions, docker, pulumi, nix, workflows]
supersedes: []
superseded_by: []
links:
  - issue: https://github.com/jmmaloney4/toolbox/issues/75
  - related-adr: https://github.com/addendalabs/yard/blob/adr-034/docs/internal/designs/040-container-image-cicd-workflow.md
  - adr-002: ./002-nix-image-publish.md
---

# Context

## Problem Statement

Consumer repositories need to coordinate container image builds with infrastructure deployments (Pulumi) such that:

1. **Image build completes before deployment** - Pulumi needs the image tag/digest to exist in the registry
2. **Immutable artifact promotion** - Same image tag can be promoted through dev → stage → prod
3. **Explicit version control** - What image version is deployed should be traceable and reproducible
4. **Manual deployment support** - Operators can deploy specific image versions on demand
5. **CI cost optimization** - Skip unnecessary image rebuilds when only infrastructure code changes

This is motivated by the "chicken-and-egg" problem where:
- Pulumi code needs an image reference (tag or digest)
- If hardcoded in code, any code change triggers rebuild with new digest
- Nix local image digests differ from registry digests due to manifest reformatting
- The cycle repeats infinitely

## Current State

The toolbox provides two independent reusable workflows:

- **`nix.yml`**: Builds and pushes images with tags like `pr-{number}` or `sha-{sha},{branch},latest`
- **`pulumi.yml`**: Detects and deploys Pulumi stacks

These workflows have no coordination mechanism. Consumers must:
- Call them separately in the correct order
- Have no way to pass the built image tag to Pulumi
- Risk race conditions if Pulumi runs before images are pushed
- Cannot easily deploy specific image versions manually

## Constraints

- MUST support immutable artifact promotion (same tag across environments)
- MUST guarantee image build completes before Pulumi deploy
- MUST integrate with existing GitHub Actions + Pulumi workflow
- MUST work with nix2container-built images
- SHOULD minimize CI complexity and cost
- SHOULD remain backward compatible with existing consumers
- SHOULD support both automated and manual deployments

## Related Work

- **ADR-002** established the current image publishing mechanism with `passthru.copyTo`
- **Issue #75** separated image building from checks to prevent silent push failures
- **yard ADR-040** (external) documents the SHA-tagging pattern for immutable deployments

# Decision

We will implement a **hybrid approach** combining convention-based defaults with explicit orchestration:

1. **MUST adopt SHA-based tagging convention** - Both `nix.yml` and `pulumi.yml` will default to `sha-{SHORT_SHA}` tags
2. **MUST add image tag inputs** - Both workflows accept optional `image-tag` input for overrides
3. **SHOULD create orchestrator workflow** - New `deploy.yml` workflow coordinates build→deploy
4. **MUST create tag computation action** - Shared composite action for consistent tag logic
5. **MAY add path filtering** - Consumers can optimize by skipping builds when only infra changes

## Tag Format

The standard tag format is:
```
sha-{GITHUB_SHA:0:7}
```

Examples:
- `sha-abc1234` - Built from commit abc1234567...
- `sha-def5678` - Built from commit def5678901...

Tags are immutable and tied to specific Git commits, enabling:
- Reproducible deployments
- Easy rollbacks
- Promotion across environments
- Audit trails

## Workflow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPTION 1: Orchestrated                       │
├─────────────────────────────────────────────────────────────────┤
│  Consumer calls: deploy.yml                                     │
│                                                                 │
│  deploy.yml orchestrates:                                       │
│    1. compute-tag job → outputs SHA tag                        │
│    2. nix.yml (conditional) → builds and pushes with tag       │
│    3. pulumi.yml → deploys with --config imageTag=sha-xxx      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    OPTION 2: Convention-Based                   │
├─────────────────────────────────────────────────────────────────┤
│  Consumer calls:                                                │
│    1. nix.yml (builds with sha-{SHA} by default)              │
│    2. pulumi.yml (deploys with sha-{SHA} by default)          │
│                                                                 │
│  Both use same compute-image-tag action internally             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    OPTION 3: Manual Override                    │
├─────────────────────────────────────────────────────────────────┤
│  workflow_dispatch with inputs:                                │
│    image_tag: "sha-abc1234"                                    │
│                                                                 │
│  Workflow calls pulumi.yml with explicit tag                   │
│  (skips image build entirely)                                  │
└─────────────────────────────────────────────────────────────────┘
```

# Consequences

## Positive

- ✅ **Explicit dependencies** - `needs:` in workflows guarantees build-before-deploy
- ✅ **Immutable deployments** - SHA tags enable reproducible, auditable deployments
- ✅ **Manual control** - Operators can deploy any previously-built image version
- ✅ **Backward compatible** - Existing workflows continue working with sensible defaults
- ✅ **Simple consumer workflows** - Convention reduces boilerplate, orchestrator simplifies further
- ✅ **Cost optimized** - Path filters can skip unnecessary image builds
- ✅ **No digest lookup required** - Cloud Run/GKE resolves tag→digest at deploy time

## Negative

- ⚠️ **More workflows to maintain** - Adds `deploy.yml` orchestrator and `compute-image-tag` action
- ⚠️ **Convention coupling** - `nix.yml` and `pulumi.yml` must stay aligned on tag format
- ⚠️ **GitHub Actions limitations** - Reusable workflows cannot output directly, requiring workarounds
- ⚠️ **Tag accumulation** - Old SHA tags accumulate in registries (mitigated with lifecycle policies)
- ⚠️ **Learning curve** - Three usage patterns may confuse new users (mitigated with good docs)

# Alternatives

## Option A: Add Outputs to Reusable Workflows (Minimal)

**Description:**
Add `image_tag` input to `pulumi.yml` and output from `nix.yml`. Consumers wire up dependencies manually.

**Pros:**
- Minimal changes to existing workflows
- Backward compatible
- Clear dependency chain with `needs:`

**Cons:**
- ❌ **GitHub limitation**: Reusable workflows cannot output directly
- Requires wrapper job in consumer repo to extract outputs
- Consumers must wire dependencies manually
- Verbose consumer workflows

**Verdict:** ❌ Not recommended due to GitHub Actions limitations

## Option B: Unified Orchestrator Workflow (Recommended ✅)

**Description:**
Create new `deploy.yml` that orchestrates both `nix.yml` and `pulumi.yml`, handling tag computation and job dependencies.

**Pros:**
- Single entry point for consumers
- Encapsulates build→deploy coordination
- Can output the image tag used
- Supports both auto-build and manual tag override
- Consumers don't wire dependencies

**Cons:**
- Adds workflow to maintain
- Less flexible for consumers who only want build OR deploy
- Still need to modify `pulumi.yml` to accept image config

**Verdict:** ✅ **Recommended** - Best balance of simplicity and flexibility

## Option C: Composite Action for Tag Management

**Description:**
Create `.github/actions/compute-image-tag` that generates tags. Both workflows use it internally.

**Pros:**
- Centralized tag computation logic
- Reusable across workflows
- Easy to test independently
- Can add validation, formatting, etc.

**Cons:**
- Still need consumer to wire up dependencies
- Doesn't solve output limitation of reusable workflows

**Verdict:** ✅ **Recommended** - Use in conjunction with Option B

## Option D: Path-Filtered Build with Artifacts

**Description:**
Use `dorny/paths-filter` to detect changes, write tag to artifact, download in deploy job.

**Pros:**
- Path filtering optimizes CI minutes
- Artifacts are explicit and debuggable
- Works around reusable workflow output limitations

**Cons:**
- Verbose consumer workflows (extra job for artifact reading)
- Artifacts have retention/storage implications
- More complex to understand

**Verdict:** ⚠️ **Optional** - Can layer on top for CI optimization if needed

## Option E: Convention-Based Tagging (Simplest ✅)

**Description:**
Don't pass tags. Both workflows use the same convention (`sha-{SHA}`) computed independently.

**Pros:**
- Extremely simple - no wiring needed
- Minimal changes to existing workflows
- Convention over configuration
- Still supports manual override via input

**Cons:**
- Implicit coupling between workflows
- Harder to deploy different tag than what was built
- Both workflows must stay in sync on convention

**Verdict:** ✅ **Recommended** - Use as the default mechanism

## Option F: Separate Workflows with workflow_run

**Description:**
Use `workflow_run` trigger to automatically start deploy after build completes.

**Pros:**
- Clean separation of concerns
- Path filtering built-in
- Independent workflow runs

**Cons:**
- Complex data passing (artifacts or API)
- Harder to debug (two workflows)
- Security considerations with `workflow_run`
- Branch filtering quirks

**Verdict:** ❌ Not recommended - Overkill for current scale

# Recommendation Matrix

| Use Case | Recommended Option | Why |
|----------|-------------------|-----|
| **You control all consumer repos** | **Option B (Orchestrator)** | Simplest for consumers, encapsulates complexity |
| **Public/external consumers** | **Option E (Convention)** + inputs for overrides | Convention for defaults, explicit control when needed |
| **Need maximum flexibility** | **Option C (Composite Action)** | Reusable primitives, consumers compose |
| **Optimize CI minutes is critical** | **Option D (Path filtering + Artifacts)** | Fine-grained control over when builds run |
| **Simple, common case** | **Option E (Convention)** | Zero boilerplate, just works |

# Implementation Plan

## Phase 1: Foundation (MVP)

1. **Create `.github/actions/compute-image-tag`** (Option C)
   - Input: `override-tag` (optional), `commit-sha` (required)
   - Output: `tag` (computed or override)
   - Logic: `${override-tag:-sha-${commit-sha:0:7}}`

2. **Modify `nix.yml`** (Option E)
   - Add input: `image-tag-override` (optional)
   - Use `compute-image-tag` action in detect job
   - Pass computed tag to `build-and-push-images` job
   - Default behavior unchanged (auto-generates from SHA)

3. **Modify `pulumi.yml`** (Option E)
   - Add input: `image_tag` (optional)
   - Use `compute-image-tag` action if tag not provided
   - Pass to pulumi via `--config imageTag=${TAG}`
   - Default behavior unchanged (auto-generates from SHA)

## Phase 2: Orchestration (Enhanced UX)

4. **Create `.github/workflows/deploy.yml`** (Option B)
   - Input: `image_tag` (optional), `skip_image_build` (optional)
   - Output: `image_tag` (what was actually used)
   - Jobs:
     - `compute-tag`: Compute tag, decide if build needed
     - `build-images`: Call `nix.yml` (conditional)
     - `deploy`: Call `pulumi.yml` with tag

## Phase 3: Optimization (Cost Savings)

5. **Add path filtering** (Option D - optional)
   - Use `dorny/paths-filter@v3` in `deploy.yml`
   - Skip image build if only `pulumi/**` or `.github/**` changed
   - Fall back to last-known good tag or `:latest`

## Phase 4: Documentation

6. **Update docs/public/workflows.md**
   - Document three usage patterns (orchestrated, convention, manual)
   - Provide examples for each pattern
   - Migration guide for existing consumers

7. **Add examples to dogfood workflows**
   - Update `_dogfood-nix.yml` to use new pattern
   - Demonstrate orchestrator usage
   - Show manual override example

## Task Breakdown

- **T1**: Create `compute-image-tag` composite action (S) — 2-4 hours
- **T2**: Modify `nix.yml` to use tag action (M) — 4-6 hours
- **T3**: Modify `pulumi.yml` to accept image tag (M) — 4-6 hours
- **T4**: Create `deploy.yml` orchestrator workflow (M) — 6-8 hours
- **T5**: Add path filtering support (S) — 2-4 hours
- **T6**: Update documentation (M) — 4-6 hours
- **T7**: Update dogfood workflows (S) — 2-4 hours
- **T8**: Test end-to-end in consumer repo (M) — 4-6 hours

**Critical path:** T1 → T2 → T3 → T4 → T8

**Estimated total effort:** 28-44 hours

# Security / Privacy / Compliance

## Image Tags and Registry Security

- SHA-based tags are immutable and traceable to Git commits
- No PII or secrets in tag names
- Uses existing `GITHUB_TOKEN` for registry auth
- Requires `permissions: packages: write` (already required by ADR-002)

## Supply Chain Security

- Immutable tags prevent tag hijacking attacks
- Clear audit trail from commit → build → deploy
- Supports future integration with:
  - Image signing (cosign)
  - SBOM generation
  - Vulnerability scanning gates

## Secrets Management

- No new secrets required
- Pulumi backend credentials remain in consumer repos
- GCP Workload Identity (existing) for cloud deployments

# Operational Notes

## Cost Considerations

- **Reduced waste**: Path filtering prevents unnecessary image rebuilds
- **Storage costs**: Old SHA tags accumulate in registry
  - **Mitigation**: Set lifecycle policy to delete tags older than N days (e.g., 90)
  - **Mitigation**: Keep tags referenced in production deployments (use labels)
- **Compute costs**: Orchestrator adds minimal overhead (tag computation is cheap)

## Observability

- Image tags visible in GitHub Actions logs
- Pulumi config shows which tag was deployed
- Cloud Run/GKE shows resolved digest in service metadata
- GitHub Packages shows all available tags with timestamps

## Rollback / Recovery

- **Rollback**: `workflow_dispatch` with previous SHA tag
- **Emergency fix**: Build and push hotfix branch, deploy with custom tag
- **Audit trail**: Git commit → Actions run → Registry push → Pulumi deploy

## Quotas / Limits

- GitHub Packages: 500MB free, then pay-per-GB
- GitHub Actions: 2000 minutes/month free (private repos)
- No additional quotas beyond existing infrastructure

# Status Transitions

- **Current status**: Proposed
- **Next steps**:
  1. Review and approve this ADR
  2. Implement T1-T3 (foundation) in PR
  3. Test in dogfood workflows
  4. Implement T4-T8 (orchestration + docs)
  5. Update status to Accepted

# References

## Related ADRs

- [ADR-002: Nix Image Publishing](./002-nix-image-publish.md) - Established current image push mechanism
- [yard ADR-040](https://github.com/addendalabs/yard/blob/adr-034/docs/internal/designs/040-container-image-cicd-workflow.md) - Motivated SHA-tagging pattern

## Issues & PRs

- [Issue #75](https://github.com/jmmaloney4/toolbox/issues/75) - Separated image build from checks
- Implementation PR: TBD

## External References

- [GitHub Actions: Reusable Workflows](https://docs.github.com/en/actions/using-workflows/reusing-workflows)
- [GitHub Packages: Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Pulumi: Configuration](https://www.pulumi.com/docs/concepts/config/)
- [nix2container: passthru.copyTo](https://github.com/nlewo/nix2container)

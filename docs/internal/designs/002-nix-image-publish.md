---
id: ADR-002
title: Publish Nix flake *-image packages to GHCR post-build
status: Accepted
date: 2025-09-11
deciders: [team-zeus]
consulted: [platform, security]
tags: [nix, ghcr, ci, workflows]
supersedes: []
superseded_by: []
links:
  - pr: https://github.com/jmmaloney4/toolbox/pull/33
  - guide: ../internal/designs/000-adr-template.md
  - workflow: ../../.github/workflows/nix.yml
---

## Context

- We build Nix flake packages via a reusable matrix workflow (`.github/workflows/nix.yml`). Some packages produce container images (flake outputs named `*-image`) and expose `passthru.copyTo` for registry pushes.
- We want successful image outputs to be pushed to `ghcr.io` with consistent tags, without duplicating logic across repos or inlining large shell blocks in workflows.
- cavinsresearch/zeus PR 318 demonstrated an effective approach: record success via small `.env` artifacts, then a post-matrix job pushes to GHCR using `nix run .#<name>.passthru.copyTo`, with a clear tag policy and minimal secrets (`GITHUB_TOKEN` only).

## Decision

- Enhance the reusable `nix.yml` workflow to publish successfully built `packages.*.*.<name>-image` outputs to GHCR using a simplified composite action approach.
- Image discovery and publishing are handled in a single streamlined process:
  - The build job uses `nix eval` to discover successful `*-image` packages and their `copyTo` attributes
  - Images are pushed directly using `nix run .#<name>.passthru.copyTo` with git SHA tagging
  - Primary destination: `docker://ghcr.io/<namespace>/<image-name>:git-<sha>`
- Authentication uses `--dest-creds "${GITHUB_ACTOR}:${GITHUB_TOKEN}"` and requires `permissions: packages: write` on the workflow.
- The reusable workflow remains fully parameterized:
  - `runs-on`: runner label for all jobs (caller-specified)
  - `repository`, `ref`: caller context for checkout in every job
  - Optional `ghcr-namespace` defaults to the caller's `${{ github.repository }}` if not provided
- Implementation follows the composable-actions pattern:
  - `push-ghcr-images`: single composite action that discovers and pushes images using nix commands directly

## Consequences

- **Simplified Architecture**: Single composite action reduces complexity and potential failure points compared to the original two-action approach.
- **Direct Nix Integration**: Uses nix commands directly instead of intermediate artifacts, making the workflow more reliable and easier to debug.
- **Git SHA Tagging**: Simplified tagging strategy focuses on immutable git SHA tags, removing complex conditional tagging logic.
- **Centralized Image Discovery**: The push action discovers successful builds using nix commands rather than relying on separate artifact creation.
- **Minimal Dependencies**: Reduced reliance on artifact storage and download, making the workflow more self-contained.
- Requires composite actions to be hosted and pinned (e.g., `jmmaloney4/toolbox@<ref>`), and `packages: write` permission declared.

## Alternatives Considered

- **Original Two-Action Approach**: Initially designed with separate `prepare-image-artifact` and `push-ghcr-images` actions using `.env` artifacts, but simplified to single action for better reliability.
- Inline shell within `nix.yml`: harder to maintain; violates our composable actions guideline.
- Use non-Nix push tooling: diverges from `passthru.copyTo` and Nix-native flow.
- Complex conditional tagging: considered but simplified to git SHA only for better traceability.
- Multi-arch manifest assembly: deferred; can be layered later if needed.

## Security/Privacy/Compliance

- Uses OIDC + `GITHUB_TOKEN`; no additional secrets. Scope limited to `packages: write`.
- Image provenance/signing (e.g., cosign) and SBOM generation are out of scope for this ADR and may be addressed in future ADRs.

## Operational notes

- Add retry/backoff inside the push composite action later if registry flakiness is observed.
- Ensure image base includes minimal tooling needed in GH Actions contexts (e.g., `coreutils`, `git`, `nix`).
- The push action discovers successful builds using nix commands and fails fast if no images are found to push.
- Error handling focuses on nix command failures rather than artifact parsing issues.

## Status transitions

- Status: Accepted. Implemented in PR #33 with simplified approach using single composite action instead of the originally planned two-action approach. The implementation uses direct nix command integration rather than artifact-based discovery for improved reliability and maintainability.

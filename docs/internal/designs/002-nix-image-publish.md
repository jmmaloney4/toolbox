---
id: ADR-002
title: Publish Nix flake *-image packages to GHCR post-build
status: Proposed
date: 2025-09-11
deciders: [team-zeus]
consulted: [platform, security]
tags: [nix, ghcr, ci, workflows]
supersedes: []
superseded_by: []
links:
  - pr: https://github.com/cavinsresearch/zeus/pull/318
  - guide: ../internal/designs/000-adr-template.md
  - workflow: ../../.github/workflows/nix.yml
---

## Context

- We build Nix flake packages via a reusable matrix workflow (`.github/workflows/nix.yml`). Some packages produce container images (flake outputs named `*-image`) and expose `passthru.copyTo` for registry pushes.
- We want successful image outputs to be pushed to `ghcr.io` with consistent tags, without duplicating logic across repos or inlining large shell blocks in workflows.
- cavinsresearch/zeus PR 318 demonstrated an effective approach: record success via small `.env` artifacts, then a post-matrix job pushes to GHCR using `nix run .#<name>.passthru.copyTo`, with a clear tag policy and minimal secrets (`GITHUB_TOKEN` only).

## Decision

- Enhance the reusable `nix.yml` workflow to publish any successfully built `packages.*.*.<name>-image` output to GHCR using two composite actions, referenced by repository path (no local action paths), per `AGENTS.md` guidance.
- The build job writes an artifact `image-<base>.env` when a `*-image` output succeeds, where `<base>` strips the `-image` suffix. The artifact contains:
  - `RUN_ATTR=#<name>.passthru.copyTo`
  - `IMAGE_NAME=<base>`
- A post-matrix job downloads all `image-*.env` files and pushes to GHCR:
  - Primary destination: `docker://ghcr.io/<namespace>/<IMAGE_NAME>:git-<sha>`
  - Additional tags:
    - `latest` when pushing from `main`
    - `pr-<number>` for pull request events
- Authentication uses `--dest-creds "${GITHUB_ACTOR}:${GITHUB_TOKEN}"` and requires `permissions: packages: write` on the workflow.
- The reusable workflow remains fully parameterized:
  - `runs-on`: runner label for all jobs (caller-specified)
  - `repository`, `ref`: caller context for checkout in every job
  - Optional `ghcr-namespace` defaults to the caller’s `${{ github.repository }}` if not provided
- Implementation follows the composable-actions pattern:
  - `prepare-image-artifact`: emits the `.env` descriptor on successful image builds
  - `push-ghcr-images`: downloads descriptors and performs pushes via `nix run .#…passthru.copyTo`

## Consequences

- Centralizes image publish behavior; thin workflows; minimal secret handling.
- Tagging remains consistent and branch-aware; no pushes occur if no `*-image` outputs succeed.
- Requires composite actions to be hosted and pinned (e.g., `jmmaloney4/toolbox@<ref>`), and `packages: write` permission declared.

## Alternatives

- Inline shell within `nix.yml`: harder to maintain; violates our composable actions guideline.
- Use non-Nix push tooling: diverges from `passthru.copyTo` and Nix-native flow.
- Multi-arch manifest assembly: deferred; can be layered later if needed.

## Security/Privacy/Compliance

- Uses OIDC + `GITHUB_TOKEN`; no additional secrets. Scope limited to `packages: write`.
- Image provenance/signing (e.g., cosign) and SBOM generation are out of scope for this ADR and may be addressed in future ADRs.

## Operational notes

- Add retry/backoff inside the push composite action later if registry flakiness is observed.
- Ensure image base includes minimal tooling needed in GH Actions contexts (e.g., `coreutils`, `git`, `nix`).
- Continue scanning all `.env` descriptors; fail the job if any individual push fails.

## Status transitions

- Status: Proposed. Upon acceptance, implement the two composite actions and wire them into `nix.yml` per this ADR. Link the implementation PRs here once merged.

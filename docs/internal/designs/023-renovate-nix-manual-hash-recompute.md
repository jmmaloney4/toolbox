---
id: ADR-023
title: Surface Nix fetchFromGitHub version bumps without automatic hash rewrite
status: Proposed
date: 2026-05-17
deciders: [jmmaloney4]
consulted: []
tags: [design, adr, renovate, nix, dependencies]
supersedes: []
superseded_by: []
links:
  - '[ADR-007](./007-renovate-config-restructuring.md)'
  - '[Renovate regex manager docs](https://docs.renovatebot.com/modules/manager/regex/)'
  - '[Renovate self-hosted configuration](https://docs.renovatebot.com/self-hosted-configuration/)'
  - https://github.com/cavinsresearch/zeus/pull/794
---

# Context

Sector7 ships Renovate presets that downstream repositories extend. The Nix preset needs to do two things at once:

1. surface upstream version changes for Nix package sources, and
2. avoid generating PRs that break consumers by rewriting Nix hashes incorrectly.

The failure mode that triggered this ADR is a Renovate PR that updated a Nix `fetchFromGitHub` source revision while leaving the consumer with an invalid hash state. In the Zeus consumer repo, that produced a broken Nix evaluation rather than a clean signal that manual hash recomputation was required.

We considered using Renovate's regex manager to rewrite both the revision and the hash inside multiline Nix blocks. That approach proved too brittle for a shared preset:

- Renovate's regex manager uses RE2, which does not support lookahead or backreferences.
- `fetchFromGitHub` blocks are multiline structured text, not simple key/value pairs.
- `autoReplaceStringTemplate` was fragile enough that small capture mistakes could corrupt the file or remove parts of the block.
- A shared preset must be safe for every downstream repo that imports it, not just one hand-tuned consumer.

In scope:

- Renovate behavior for Nix `fetchFromGitHub` entries.
- Whether the shared preset should try to rewrite Nix hashes automatically.
- Whether Renovate should still surface version-bump PRs even when the hash remains manual.

Out of scope:

- Adding self-hosted Renovate bot configuration.
- Building a companion GitHub Action or other post-upgrade automation.
- Changing other Nix managers such as `fetchPypi`.

# Decision

Sector7's shared Renovate preset MUST NOT attempt automatic hash recomputation for Nix `fetchFromGitHub` dependencies.

Instead, the preset SHOULD allow Renovate to surface version-bump PRs for these sources while leaving the hash untouched for a maintainer to recompute manually before merge.

Concretely:

- Renovate MAY detect and update the source revision / version field for a matching `fetchFromGitHub` block.
- Renovate MUST NOT use regex templates that rewrite the Nix hash as part of the shared preset.
- The preset MUST NOT standardize a placeholder hash rewrite such as `lib.fakeHash` or `null` in shared config.
- Downstream maintainers MAY recompute the real Nix hash manually and update the PR before merge.

This ADR intentionally chooses a simpler failure mode: the PR may be red until a human supplies the correct hash, but the repository stays structurally intact and Renovate does not generate destructive edits.

# Consequences

## Positive

- Renovate can still surface upstream version availability for Nix `fetchFromGitHub` sources.
- The shared preset avoids the brittle multiline rewrite logic that previously broke consumer repos.
- Maintainers get a clear manual follow-up step: compute the new hash, update the PR, then merge.
- The config stays understandable and safe to reuse across repos.

## Negative

- Version-bump PRs will not be mergeable until someone recomputes the hash.
- CI will likely fail on the generated PR until the hash is updated.
- Maintainers must do an extra manual step for each `fetchFromGitHub` bump.

## Neutral

- This does not solve automated hash recomputation.
- The preset still supports other Nix update patterns where Renovate can safely manage the value directly.

# Alternatives

## Alternative A: Rewrite the hash automatically with a regex manager

Use `autoReplaceStringTemplate` or a similar regex-based rewrite to replace the hash with a placeholder such as `lib.fakeHash` or an equivalent sentinel.

**Pros:**

- The PR would visibly communicate that a hash recomputation is required.
- In theory, a maintainer could update only the hash later.

**Cons:**

- This is the approach that proved fragile.
- It relies on multiline capture and template reconstruction in a shared preset.
- Small regex mistakes can corrupt the Nix file or remove content.

**Decision:** Rejected for the shared preset.

## Alternative B: Version-bump-only PRs with manual hash recomputation

Let Renovate update only the revision / version field and leave the hash untouched.

**Pros:**

- Safe for a shared preset.
- No destructive rewrite logic.
- Still surfaces upstream updates in PR form.

**Cons:**

- PRs are expected to fail validation until a maintainer recomputes the hash.
- Requires a manual follow-up step.

**Decision:** Accepted.

## Alternative C: Add a supported recomputation step outside Renovate

Use self-hosted Renovate `postUpgradeTasks` or a companion GitHub Action to recompute the Nix hash after Renovate opens the PR.

**Pros:**

- Full automation.
- Cleaner end state than a manual PR follow-up.

**Cons:**

- Requires bot-level or workflow-level execution rights that are not available in the shared preset alone.
- Adds an additional moving part.
- Better suited to a repo-specific integration than a shared preset.

**Decision:** Deferred to a future ADR if we adopt self-hosted Renovate or a companion workflow.

# Security / Privacy / Compliance

- No secrets, credentials, or private data are introduced by this decision.
- The recommended manual follow-up does not require broader execution permissions in Renovate.
- Avoiding automatic hash rewriting reduces the risk of shipping broken artifacts from a malformed PR.

# Operational Notes

- Downstream repos should treat these Renovate PRs as "version available, hash pending" updates.
- CI failures on these PRs are expected until the hash is recomputed.
- The manual hash recomputation method should be documented in the consumer repo or workflow notes if this pattern is adopted widely.
- If Sector7 later gains a supported hash recomputation workflow, this ADR SHOULD be superseded rather than retrofitted with more regex complexity.

# Status Transitions

- This ADR supersedes no prior ADR.
- If a later decision introduces self-hosted Renovate or a companion hash-rewrite workflow, that decision SHOULD reference this ADR as the manual fallback baseline.

# Implementation Notes

- Keep `renovate/nix.json` focused on safe dependency detection.
- Do not reintroduce multiline hash rewrite templates in the shared preset.
- If a consumer wants a stronger automation path, implement it in that consumer repo or in a future repo-specific workflow ADR.

# References

- [ADR-007: Renovate Configuration Restructuring for Update Type Separation](./007-renovate-config-restructuring.md)
- [Renovate regex manager docs](https://docs.renovatebot.com/modules/manager/regex/)
- [Renovate self-hosted configuration](https://docs.renovatebot.com/self-hosted-configuration/)
- Zeus PR showing the consumer failure mode: https://github.com/cavinsresearch/zeus/pull/794

---
id: ADR-012
title: Exclude derivations from CI via meta.ci.skip
status: Proposed
date: 2026-04-15
deciders: [jmmaloney4]
consulted: []
tags: [nix, ci, github-actions]
supersedes: []
superseded_by: []
links:
  - workflow: ../../.github/workflows/nix.yml
  - action: ../../.github/actions/compute-flake-build-matrix
  - precedent: https://code.tvl.fyi/about/nix/buildkite/default.nix
---

# Context

The reusable `nix.yml` workflow discovers all `packages` and `checks` flake outputs via `nix-eval-jobs` and builds any that are not already cached. This works well but offers no way to exclude a derivation from CI without removing it from the flake entirely.

Several repos now have derivations that should exist in the flake (buildable on demand, referenced by other targets) but should not consume CI resources on every push. Examples include long-running integration checks, platform-specific packages that cross-compile but fail in CI sandboxes, and checks that are explicitly WIP.

Removing the derivation from the flake is too aggressive: it breaks local workflows and `nix build .#<name>` for developers. What we need is an opt-out mechanism that keeps the derivation in the flake output but signals "do not build this in CI."

# Decision

Adopt `meta.ci.skip = true` as the standard attribute for excluding a Nix derivation from automated CI builds.

## Semantics

- A derivation with `meta.ci.skip = true` MUST be excluded from the build matrix in `nix.yml`.
- The derivation MUST still appear in the flake output and be buildable locally via `nix build .#<name>`.
- The attribute MUST be a boolean. Non-boolean values are treated as absent (i.e. not skipped).
- The attribute SHOULD be set at the derivation level, not inferred from category or naming conventions.

## Attribute path: `meta.ci.skip` (not `meta.ci`)

The nested `meta.ci.skip` path is chosen over a flat `meta.ci = false` for extensibility. Future CI-related metadata (timeouts, resource hints, runner affinity) can be added under `meta.ci` without repurposing the top-level key. This follows the pattern used by the TVL depot monorepo, which uses `meta.ci.skip` for the same purpose and also defines `meta.ci.extraSteps` for additional CI behavior.

## Implementation: filter in main.sh via jq

The filter is applied in `compute-flake-build-matrix/main.sh` during the jq transform of `nix-eval-jobs` output. The `--meta` flag is already passed to `nix-eval-jobs`, so `meta.ci.skip` is available in each JSON line.

Two changes in `main.sh`:

1. In the first jq block (building `all_outputs`), extract and carry the skip signal:

   ```jq
   ci_skip: ((.meta.ci.skip? == true) // false)
   ```

   Note: The `?` optional operator guards against misconfigured `meta.ci` values (e.g. `meta.ci = true` instead of `meta.ci.skip = true`). When the path fails, `?` produces `empty` (not `null`), so `empty == true` produces `empty`, which would omit the key entirely. The `// false` fallback ensures `ci_skip` is always a boolean.

2. In the second jq block (building `include_array`), filter out skipped targets:

   ```jq
   | map(select(.ci_skip == false))
   ```

3. In the summary table rendering, show skipped targets with a visual indicator (e.g. "⏭️ skipped") so developers can see what was excluded.

## Usage in flake derivations

```nix
pkgs.runCommand "expensive-integration-test" {
  meta.ci.skip = true;
} ''
  # Still buildable locally, just not in CI
''
```

Or with `stdenv.mkDerivation`:

```nix
stdenv.mkDerivation {
  pname = "wip-tool";
  version = "0.0.1";
  # ...
  meta.ci.skip = true;
}
```

# Consequences

## Positive

- Derivations remain in the flake for local use; only CI is affected.
- Simple, declarative, no workflow-level allow/deny lists to maintain.
- Extensible: `meta.ci` namespace can grow (timeouts, runner hints, etc.).
- Consistent with established community precedent (TVL depot).
- No changes required to `select.nix` or the evaluation pipeline.

## Negative

- Requires `--meta` on `nix-eval-jobs` (already set, but now a hard dependency).
- Slightly larger JSON output from nix-eval-jobs (meta fields are serialized).
- Developers must remember to remove `meta.ci.skip` when a derivation is ready for CI; no automated reminder.
- Not enforced by Nix itself -- a derivation with `meta.ci.skip = true` will still build if referenced as a dependency of a non-skipped target.

# Alternatives

- **`meta.ci = false` (flat boolean):** Simpler but loses extensibility. If we ever need CI timeouts or runner hints, we'd have to add a separate top-level key or break the convention. Rejected in favor of the nested namespace.

- **Workflow-level exclude list in nix.yaml config:** A separate YAML file listing attr names to skip. More visible than `meta` attributes but creates a second source of truth that drifts from the derivations themselves. Rejected: the skip intent belongs with the derivation.

- **Filter in `select.nix` (evaluation time):** Filter at the Nix level so nix-eval-jobs never emits the target. Problem: `select.nix` operates on the raw flake output attrset, not on instantiated derivations. Reading `meta` requires forcing the derivation, which defeats the lazy-evaluation benefit of nix-eval-jobs. Rejected for architectural reasons.

- **Convention: don't include in checks/packages, use a separate category:** Move skipped derivations to a custom flake output like `ci-skip`. Clean separation but requires callers to know about the custom output and makes local builds less discoverable. Rejected: `nix build .#checks.foo` should work regardless of CI status.

- **`meta.broken = true`:** Already understood by Nix tooling, but `broken` means "this derivation does not build correctly" and causes `nix build` to refuse unless `--impure` or `allowBroken` is set. Semantically wrong for "works fine, just don't run in CI."

# Security / Privacy / Compliance

No credentials or sensitive data involved. The `meta.ci.skip` attribute is purely a build orchestration hint with no security implications.

# Operational Notes

- The CI step summary table should clearly indicate which outputs were skipped and why, to avoid confusion about "missing" builds.
- If a skipped derivation is a runtime dependency of a non-skipped target, it will still be built as part of that target's closure (standard Nix behavior). `meta.ci.skip` only affects top-level matrix inclusion.
- No rollout risk: adding the filter is purely additive. Derivations without `meta.ci.skip` are unaffected.

# Implementation Notes

- Patch `compute-flake-build-matrix/main.sh` to carry `ci_skip` through the jq transforms and filter on it.
- Update the summary table to show skipped entries.
- No changes to `select.nix`, `action.yml`, or `nix.yml`.

# References

- TVL depot `meta.ci.skip` precedent: https://code.tvl.fyi/about/nix/buildkite/default.nix
- nix-eval-jobs `--meta` flag: https://github.com/nix-community/nix-eval-jobs
- Compute-flake-build-matrix action: `.github/actions/compute-flake-build-matrix/`
- Reusable workflow: `.github/workflows/nix.yml`

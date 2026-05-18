# ADR 025: Unified Monorepo Release

*Date:* 2026-05-18
*Status:* proposed

## Context

The sector7 publish pipeline (`pnpm.yml` + `analyze-pnpm-packages`) currently treats each package in `packages/` as an independent release unit:

- Tags include a per-package slug prefix (`sector7-v0.9.2`) even though there is only one published package.
- Tags include a short SHA suffix (`-007f69a`) making every publish unique per commit.
- The analyzer does per-package version comparison, registry probing, and matrix construction to decide whether each package needs publishing independently.

This design was built to support arbitrary monorepo topologies: multiple packages at independent versions, published to different registries at different cadences. But the actual use case is narrow:

- One package (`@jmmaloney4/sector7`).
- One target (GitHub Release tarball).
- All consumers are internal repos owned by the same org.
- Consumers update quickly and take all changes together.

The slug prefix is redundant when there is only one package. The SHA suffix means the same version string produces infinitely many tags, which complicates Renovate integration and makes tag history noisy without adding value for an internal-only artifact. The per-package analysis machinery (registry version checks, semver comparison, matrix fan-out) is over-engineered for a single-package unified release.

## Decision

Release all packages in the monorepo together at a single version, using plain semver tags.

### Tag format

`v${version}` (e.g. `v0.10.0`).

No slug prefix. No SHA suffix. One tag per release.

### Version source

The root `package.json` `version` field is the single source of truth. All packages under `packages/*/` must have the same `version` field. The publish workflow validates this invariant before proceeding — if any package version diverges from the root version, the workflow exits with an error listing the mismatches.

A bump happens once in root `package.json`, then all packages must be updated to match before the release proceeds.

### Release decision

Check whether a tag `v${version}` already exists. If not, pack all packages, create one GitHub Release with all tarballs attached.

This replaces the current per-package registry/release probing and matrix fan-out with a single boolean check.

### When new packages are added

They ship at the same version as the existing package(s). No per-package versioning. The release tag still covers the whole monorepo.

## Consequences

**Simpler.** The analyzer script shrinks from 265 lines to ~190 lines (including asset completeness verification). The workflow drops the registry resolution step, registry publish steps, and short_sha input.

**Cleaner tags.** `v0.10.0` instead of `sector7-v0.9.2-007f69a`. Easier for humans, easier for Renovate, easier for any tooling that parses tags.

**No partial releases.** Everything ships together or nothing ships. The analyzer verifies asset completeness: if a release tag exists but is missing expected tarballs, the publish proceeds to fill the gap. This prevents dead releases from partial upload failures.

**No republish from different commits.** Without the SHA suffix, attempting to publish the same version from a different commit fails (tag already exists). This is intentional: bump the version if you need a new release. The SHA suffix was allowing sloppy version management.

**Breaks if a second package needs independent versioning.** If sector7 grows a package that genuinely needs its own release cadence, this ADR would need to be revisited. Given the current design intent (all packages work together), this is acceptable.

**Registry targets removed.** The `ghcr`, `npm`, and `gcp` registry publish paths have been removed from the workflow and analyzer. sector7 ships as GitHub Release tarballs only. If registry publishing is needed in the future, it should be added as a separate workflow rather than coupling it to the tarball release path.

## Migration

1. Simplify `analyze-pnpm-packages/main.sh` to unified release logic.
2. Simplify `pnpm.yml` to remove matrix strategy for `target=release`, use plain `v${version}` tags.
3. Drop the `short_sha` input (no longer needed).
4. Consumers reference the new tag format in their `package.json` resolutions.

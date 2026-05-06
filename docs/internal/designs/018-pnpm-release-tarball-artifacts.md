---
id: ADR-018
title: pnpm Package Release Tarball Artifacts
status: Proposed
date: 2026-05-06
deciders: [jmmaloney4]
consulted: [addendalabs/yard]
tags: [design, adr, pnpm, release-artifacts, nix]
supersedes: [ADR-003]
superseded_by: []
links:
  - ADR-003
  - https://github.com/addendalabs/yard/pull/1145
  - https://github.com/jmmaloney4/sector7/releases/tag/sector7-v0.6.0-a27687e
---

# Context

Sector7 publishes reusable TypeScript/Pulumi package code from a monorepo under
`packages/*`. Downstream Nix-backed workspaces, including `addendalabs/yard`, need
these packages to install reproducibly without requiring `git`, `ssh`, package
registry credentials, or network-sensitive fetch behavior inside a Nix builder.

The current package publishing decision, ADR-003, uses GitHub Packages as an npm
registry. That works as a real npm package distribution mechanism, but it creates
an authentication requirement for package pulls. Even public GitHub Packages npm
packages are not frictionless public artifacts in the way npmjs.org packages or
GitHub Release assets are. That is poor developer experience for Jack-owned
shared infrastructure code consumed across repos.

The Yard Lens deployment exposed the practical failure mode:

1. A pnpm `github:` dependency for `@jmmaloney4/sector7` caused a Nix
   `node-modules` build to fail because pnpm tried to invoke `git` inside the
   sandbox.
2. Adding `git` was not the right fix. It moved the failure toward `ssh` and
   auth-dependent git clone behavior inside a Nix derivation.
3. A GitHub codeload source tarball avoided `git`, but for a monorepo subpackage
   it produced the wrong runtime package shape. The package content landed under
   `packages/sector7` instead of at the installed package root, so subpath exports
   such as `@jmmaloney4/sector7/nix-image` could not resolve.
4. A real package tarball created with `npm pack` from `packages/sector7` had the
   correct package root, `package.json`, `exports`, files, and dependency
   metadata. Uploading that `.tgz` as a GitHub Release asset allowed Yard to pin a
   normal package artifact by URL without using npmjs.org or GitHub Packages.

This ADR chooses a package artifact strategy for Sector7 packages. It is not a
decision about container image publishing, Nix image build-push flows, or Pulumi
provider design.

# Decision

Sector7 SHOULD distribute Jack-owned pnpm workspace packages as packed npm
package tarballs uploaded to GitHub Releases.

The release artifact MUST be produced from the package root with `npm pack` or
`pnpm pack`, not from a repository source archive. For `@jmmaloney4/sector7`, the
package root is `packages/sector7`, and the artifact is the `.tgz` produced by
packing that package.

Downstream consumers MAY depend directly on the GitHub Release asset URL:

```json
{
  "@jmmaloney4/sector7": "https://github.com/jmmaloney4/sector7/releases/download/sector7-v0.6.0-a27687e/jmmaloney4-sector7-0.6.0.tgz"
}
```

The reusable pnpm workflow SHOULD be changed from publishing to GitHub Packages
to creating release tarball artifacts:

- analyze packages under `packages/*/package.json`, as it does today;
- pack each publishable package with pnpm/npm from the package root;
- create or reuse a deterministic GitHub Release tag;
- upload the generated `.tgz` as a release asset;
- report release asset URLs in the workflow summary;
- support dry-run mode for PRs and callers that only want an audit report.

GitHub Packages and other npm-compatible registries MAY still be used when a
consumer explicitly wants registry semantics, private package distribution, or
semver/dist-tag behavior. They are not the default path for Sector7 packages.

The release tag convention SHOULD include package identity, version, and source
commit while package versioning discipline matures. Example:

```text
sector7-v0.6.0-a27687e
```

The asset name SHOULD match npm pack naming:

```text
jmmaloney4-sector7-0.6.0.tgz
```

# Consequences

## Positive

- Avoids npmjs.org for Jack-owned infrastructure packages.
- Avoids GitHub Packages pull authentication for public/internal shared code.
- Gives pnpm and Nix a real npm package artifact with the correct package root.
- Avoids `git`, `ssh`, and credential plumbing inside Nix `node_modules` builds.
- Keeps package artifacts close to the source repository and commit that produced
  them.
- Works with plain URL dependencies in pnpm and can be hash-pinned by Nix through
  the normal pnpm dependency hash flow.
- Preserves the existing reusable pnpm workflow shape: analyze first, then act per
  package with a matrix.

## Negative

- Release assets are not a full npm registry. There are no dist-tags, registry
  metadata queries, or native semver range resolution.
- Consumers must update URL dependencies when adopting a new artifact.
- The workflow must implement its own release/asset existence checks.
- Public release assets work cleanly. Private repositories or private release
  assets still need GitHub authentication and are less attractive for Nix-backed
  consumers.
- If the same package version is repacked from a different commit, provenance can
  become confusing. The workflow should avoid silently replacing artifacts.

# Alternatives

### 1. Continue using GitHub Packages

Pros:

- Real npm registry semantics.
- `pnpm publish` and package version queries already fit the current workflow.
- Supports private package distribution.

Cons:

- Requires authentication for package pulls, including cases that should feel
  public or low-friction.
- Adds `.npmrc` and token setup to every consumer and CI environment.
- Makes Nix-backed consumers deal with authenticated package fetches.
- Poor fit for the desired Jack-owned shared-infrastructure DX.

Rejected as the default. It remains available for packages that truly need a
private npm registry.

### 2. Publish to npmjs.org

Pros:

- Best npm/pnpm compatibility.
- Public unauthenticated pulls.
- Native semver ranges and dist-tags.
- Simplest experience for non-Nix JavaScript consumers.

Cons:

- Publishes Jack-owned infrastructure package artifacts and metadata to the public
  npm registry.
- Introduces npm account/token operations.
- Makes an external public package registry part of internal infrastructure.

Rejected for Sector7's default internal package distribution. It may be
reasonable later if a package is deliberately made public as a product.

### 3. Use GitHub source dependencies or codeload tarballs

Pros:

- Simple source pinning by commit.
- No package publishing workflow required.
- Codeload tarballs can avoid invoking `git` for some dependency shapes.

Cons:

- pnpm git dependencies can invoke `git`, `ssh`, and auth-sensitive clone behavior
  during install.
- GitHub monorepo subpackage support is leaky.
- Source archives are not npm package artifacts.
- `#path:/packages/sector7` can still install the repository root rather than the
  subpackage root, breaking runtime subpath exports.

Rejected for runtime packages consumed by Node/Pulumi. Source archive dependencies
may still be acceptable for non-runtime tooling only after installed package shape
is verified.

### 4. Host packages in Google Artifact Registry

Pros:

- Owned infrastructure.
- NPM-compatible registry support.
- Fits GCP service-account and Workload Identity patterns.
- Useful for private company package distribution.

Cons:

- Still requires authentication for package pulls.
- Requires `.npmrc`/credential-helper setup for local dev and CI.
- Nix-backed consumers still need an auth story if builds fetch directly from it.
- More infrastructure than needed for public release artifacts.

Deferred. Artifact Registry is the likely registry choice if Sector7 later needs a
private owned registry. It is not the simplest answer for public/shared release
artifacts.

### 5. Make Sector7 a Nix-only dependency

Pros:

- Strong reproducibility.
- Avoids npm registries entirely.
- Could expose package tarballs as flake outputs.

Cons:

- JavaScript/Pulumi consumers still expect npm package semantics.
- Cross-repo package consumption becomes bespoke.
- Non-Nix consumers get worse DX.

Rejected as the default package distribution path. Nix can still build and verify
Sector7, but the consumed artifact should remain a normal npm package tarball.

# Security / Privacy / Compliance

- The release asset workflow should use `GITHUB_TOKEN` with `contents: write` only
  for release creation/upload.
- It should not write package registry tokens or generated `.npmrc` files for the
  default release-asset path.
- Workflow logs must not print tokens, credentials, or npm auth config.
- Public release assets are appropriate only for packages whose source and package
  contents are intended to be public. Private package distribution needs a
  separate auth-aware decision.
- Packed tarballs should be treated as release artifacts. Replacing an existing
  artifact should be avoided unless explicitly intentional and audited.

# Operational Notes

- PRs should run the workflow in dry-run mode and print the package/version/tag
  plan without uploading assets.
- Main or release-triggered runs should create/upload missing artifacts.
- The workflow should fail loudly if a package version already has a release asset
  whose contents do not match the newly packed artifact.
- Consumers should verify runtime package shape after dependency updates, not just
  lockfile resolution. For Sector7 subpath exports, that means checking imports
  such as `@jmmaloney4/sector7/nix-image` from the consuming package.
- Nix-backed consumers still need to refresh their pnpm dependency hash after
  changing release asset URLs.

# Status Transitions

- Supersedes ADR-003 for pnpm package distribution defaults.
- ADR-003 remains useful historical context for the original GitHub Packages
  workflow design and analyzer shape.

# Implementation Notes

1. Update `.github/workflows/pnpm.yml` to replace the GitHub Packages publish job
   with a release-tarball upload job.
2. Update `.github/actions/analyze-pnpm-packages` so analysis checks GitHub
   Release tags/assets instead of GitHub Packages versions for the default path.
3. Keep dry-run output so callers can see which package artifacts would be
   created.
4. Update Sector7 README package-consumption guidance to prefer packed release
   asset URLs over codeload `#path` URLs for runtime monorepo subpackages.
5. Update downstream consumers, including Yard, to depend on release asset URLs.

# References

- ADR-003: pnpm Package Publishing to GHCR
- Yard PR using release asset dependency: https://github.com/addendalabs/yard/pull/1145
- Initial Sector7 release tarball asset: https://github.com/jmmaloney4/sector7/releases/tag/sector7-v0.6.0-a27687e
- pnpm GitHub monorepo subpackage issue: https://github.com/pnpm/pnpm/issues/8243
- pnpm GitHub dependency resolution instability: https://github.com/pnpm/pnpm/issues/4527

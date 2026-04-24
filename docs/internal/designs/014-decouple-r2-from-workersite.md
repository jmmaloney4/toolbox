---
id: ADR-014
title: Decouple R2 Upload from WorkerSite
status: Proposed
date: 2026-04-24
deciders: [platform]
consulted: []
tags: [design, adr, cloudflare, pulumi, workers, sector7, r2]
supersedes: []
superseded_by: []
links:
  - adr-005: ./005-cloudflare-workersite.md
  - adr-011: ./011-workersite-extensions.md
  - adr-013: ./013-workersite-esm-resources-fix.md
  - pr-156: https://github.com/jmmaloney4/toolbox/pull/156
  - issue-155: https://github.com/jmmaloney4/toolbox/issues/155
---

# Context

`WorkerSite` (ADR-005, extended by ADR-011, ADR-013) manages Cloudflare Workers,
R2 buckets, DNS records, and Zero Trust access policies. It also includes an
R2 upload capability via the `R2Object` dynamic resource, which uses
`@aws-sdk/client-s3` (S3-compatible API) to upload static assets to R2 at
Pulumi deploy time.

The package ships raw `.ts` source (no build step, `noEmit: true`). This means
TypeScript consumers type-check the package's source files directly, following
all transitive imports.

**Problem:** `R2Object` uses `typeof import("@aws-sdk/client-s3")` casts inside
function bodies to get type safety on dynamically-imported S3 client symbols.
When a consumer imports `WorkerSite` from the main barrel, TypeScript follows
the chain:

```
index.ts → worker-site.ts → r2object.ts → typeof import("@aws-sdk/client-s3")
```

This produces `TS2307: Cannot find module '@aws-sdk/client-s3'` for any
consumer that does not have the optional peer dependency installed — even if
they never use R2 upload functionality.

Issue #155 was opened for this. PR #156 attempted to fix it by moving
`R2Object` to a sub-path export (`@jmmaloney4/sector7/workersite/r2`), but
reviewers correctly identified that this is insufficient: `WorkerSite` still
statically imports `R2Object`, so the transitive chain remains unbroken from
the main barrel.

The root cause is **architectural coupling**: WorkerSite (infrastructure
orchestration) is entangled with R2Object (asset upload). These are separate
concerns that happen to share a bucket reference.

# Decision

1. WorkerSite MUST NOT import R2Object. The `uploadedAssets` property, the
   `new R2Object()` constructor call, and the R2 asset-upload loop MUST be
   extracted out of WorkerSite.

2. A new function (e.g. `uploadAssets` or a factory helper) in the
   `./workersite/r2` sub-path MUST handle R2 uploads. It takes the bucket
   name/credentials (available as WorkerSite outputs) and the file list, and
   returns the created R2Object resources.

3. `@aws-sdk/client-s3` becomes an **honest required peer dependency** of the
   `./workersite/r2` sub-path. Consumers who want R2 upload MUST install it.
   Consumers who only need WorkerSite infrastructure (Worker, bucket, DNS,
   Zero Trust) do not need it and will not encounter TS2307.

4. The main barrel (`./workersite/index.ts`) MUST NOT re-export anything from
   `r2object.ts` or the new `r2` sub-path. The barrel-guard type test
   (already in place) validates this at compile time.

5. The `typeof import("@aws-sdk/client-s3")` casts in `r2object.ts` MAY be
   replaced with plain static imports at the top of the file, since the
   sub-path makes the dependency requirement explicit. Dynamic imports were
   used to defer the module resolution, but they add complexity without
   benefit when the dep is a required peer for the sub-path.

# Consequences

## Positive

- Consumers of the main barrel get zero `@aws-sdk/client-s3` type-check
  exposure, regardless of their dependency tree.
- WorkerSite's API surface shrinks — it owns infrastructure, not upload.
- The R2 upload concern is independently testable and evolvable.
- Eliminates the `typeof import()` / dynamic-import pattern that was the root
  cause of TS2307.

## Negative

- Breaking change: consumers that use `WorkerSite.uploadedAssets` or pass
  `assets` to `WorkerSiteArgs` must migrate to the new `uploadAssets` helper.
- Two-step consumption: create WorkerSite, then call uploadAssets separately.
  This is slightly more verbose but makes the dependency boundary explicit.

# Alternatives

## A. Static import, honest required dependency (for the sub-path only)

Make `@aws-sdk/client-s3` a required peer dep for the `./workersite/r2`
sub-path with a plain `import` at the top of `r2object.ts`. Consumers of the
main barrel are unaffected.

- Pros: simple, no dynamic import complexity.
- Cons: does not fix the `WorkerSite → R2Object` coupling; WorkerSite still
  imports R2Object and the transitive chain remains.

## B. Decouple WorkerSite from R2Object (chosen)

Extract the upload concern into a standalone function in the r2 sub-path.

- Pros: clean separation of concerns, breaks the transitive chain at the
  architectural level, honest dependency declaration.
- Cons: breaking API change, requires consumer migration.

## C. Local interface shim

Define a minimal interface (`S3ClientLike`, `PutObjectCommandLike`) and cast
the dynamic import to it, avoiding the module resolution requirement entirely.

- Pros: no dep required for any consumer.
- Cons: parallel type stubs that silently drift from the real SDK. Maintenance
  liability. The same problem that caused the original bug (types that don't
  match runtime behavior) could recur.

# Security / Privacy / Compliance

- R2 credentials (access key ID, secret access key) are currently generated
  inside WorkerSite and passed to R2Object. After decoupling, these credentials
  MUST be exposed as WorkerSite outputs so the upload helper can receive them.
  These are Pulumi `Output<string>` (secret-wrapped by default), so the
  security posture is unchanged.

# Operational Notes

- No runtime behavior change — the same Pulumi resources are created in the
  same order. The difference is which function orchestrates the `new R2Object()`
  calls.
- Deployment rollback is straightforward: revert to the old API by importing
  from the r2 sub-path inline.

# Status Transitions

- Proposed → Accepted: pending review of implementation plan.

# Implementation Notes

See `docs/internal/plans/2026-04-24-decouple-r2-from-workersite.md`.

# References

- Issue #155: https://github.com/jmmaloney4/toolbox/issues/155
- PR #156 (partial fix, identified the deeper architectural issue):
  https://github.com/jmmaloney4/toolbox/pull/156

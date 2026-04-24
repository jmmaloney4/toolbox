---
id: ADR-015
title: Replace @aws-sdk/client-s3 with Native S3 Signing
status: Accepted
date: 2026-04-24
deciders: [platform]
consulted: []
tags: [design, adr, cloudflare, pulumi, workers, sector7, r2]
supersedes: []
superseded_by: []
links:
  - adr-014: ./014-decouple-r2-from-workersite.md
  - pr-156: https://github.com/jmmaloney4/toolbox/pull/156
  - issue-155: https://github.com/jmmaloney4/toolbox/issues/155
---

# Context

ADR-014 decoupled `R2Object` from `WorkerSite` by extracting it to a
`./workersite/r2` sub-path. This eliminated the transitive import chain that
caused TS2307 for consumers who don't use R2 upload.

However, `r2object.ts` still depends on `@aws-sdk/client-s3` — a ~200-package
dependency with native bindings — for exactly two operations:

1. **PUT Object** — upload a file to R2 via the S3-compatible endpoint
2. **DELETE Object** — remove a file from R2 via the S3-compatible endpoint

Both operations are single authenticated HTTP requests. The AWS SDK provides
no value beyond AWS Signature V4 header generation and response parsing.

This dependency causes two ongoing problems:

1. **Pulumi serialization**: Top-level `import { S3Client }` is captured by
   Pulumi's V8 source capture for dynamic providers. The SDK's dependency chain
   contains non-serializable native code, causing runtime failures during
   `pulumi up`. The previous workaround was `await import()` inside provider
   callbacks — a pattern that fights the runtime model instead of fixing the
   root cause.

2. **Dependency weight**: Pulling in the entire AWS SDK for two HTTP requests
   is disproportionate. The `@aws-sdk/client-s3` package transitively installs
   ~200 npm packages, many with optional native bindings.

The existing code already dynamically imports `node:crypto` (for MD5 ETag
computation) and `node:fs` (for file reading). Node 18+'s built-in `fetch()` and
`crypto.createHmac()` provide every primitive needed to sign S3 requests
natively — zero external dependencies.

# Decision

1. `r2object.ts` MUST NOT depend on `@aws-sdk/client-s3`. The package MUST be
   removed from both `devDependencies` and `peerDependencies`.

2. S3 request signing MUST be implemented natively using `node:crypto` (already
   dynamically imported). The signing scope is limited to exactly two operations:
   `PUT /{bucket}/{key}` and `DELETE /{bucket}/{key}` against the R2
   S3-compatible endpoint.

3. HTTP requests MUST use Node's built-in `fetch()` (Node 18+, already our
   minimum). No external HTTP library.

4. The signing implementation MUST be a self-contained helper function within
   `r2object.ts` (or a co-located module). No shared "S3 client" abstraction —
   the two operations are simple enough to inline.

5. The `R2Object` dynamic resource and `uploadAssets` function signatures
   MUST NOT change. This is an internal implementation detail, not an API
   change.

# Consequences

## Positive

- Eliminates `@aws-sdk/client-s3` entirely — no peer dep, no dev dep, no
  serialization workarounds, no version pinning concerns.
- Removes the Pulumi dynamic provider serialization issue at its root. No more
  `await import()` workarounds for AWS SDK symbols.
- Zero external dependencies for R2 operations. Only `node:crypto`, `node:fs`,
  and global `fetch()` — all built into Node 18+.
- Faster `npm install` / `pnpm install` for consumers of the `r2` sub-path
  (~200 fewer packages).
- Simpler mental model: file upload is an authenticated HTTP PUT, not an SDK
  operation.

## Negative

- Owns ~80 lines of AWS Signature V4 signing code. This is well-documented
  (AWS docs, numerous implementations) and the surface is tiny (2 operations),
  but it is code we maintain.
- If R2 operations expand beyond PUT/DELETE in the future (multipart upload,
  presigned URLs, etc.), the signing helper may need extension. At that point,
  re-evaluating whether to adopt a lightweight signing library is appropriate.

# Alternatives

## A. Keep @aws-sdk/client-s3 with dynamic imports (status quo post ADR-014)

Wrap the SDK import in `await import()` inside every provider callback to avoid
V8 source capture.

- Pros: no new code, uses a battle-tested SDK.
- Cons: perpetuates the serialization workaround pattern; heavyweight dependency
  for two HTTP requests; version churn across the ~200-package dependency tree.

## B. Replace @aws-sdk/client-s3 with native S3 signing (chosen)

Implement AWS Sig V4 signing using `node:crypto` + `fetch()`.

- Pros: zero external deps, no serialization issues, simpler dependency tree,
  ~80 lines of well-understood code for exactly the operations we need.
- Cons: owns signing code; must maintain if S3 API usage expands.

## C. Remove R2Object as a Pulumi resource

Make asset upload a post-`pulumi up` step (script, CLI, CI job).

- Pros: cleanest separation of concerns; Pulumi manages infra, not blobs.
- Cons: loses declarative asset management; static website assets are closely
  coupled to infrastructure (they're the site content); introduces a separate
  deployment step that must be coordinated with Pulumi lifecycle.

# Security / Privacy / Compliance

- No change to the authentication model. The existing `cloudflare.AccountToken`
  (created by `uploadAssets`) still provides the Access Key ID and Secret
  Access Key used for signing. These are derived per Cloudflare's spec:
  `accessKeyId = token.id`, `secretAccessKey = SHA-256(token.value)`.
- The signing key is derived per-request from the Secret Access Key using
  HMAC-SHA256. It is never persisted or logged.
- Request signing happens entirely in-process using Node's `crypto` module.
  No credentials leave the Pulumi process except in the signed Authorization
  header sent to the R2 endpoint over HTTPS.

# Operational Notes

- No change to the Pulumi resource model or deployment workflow. The same
  `R2Object` resources are created with the same inputs and outputs.
- The signing implementation uses the same AWS Signature Version 4 algorithm
  that the SDK uses. R2's S3-compatible endpoint validates signatures
  identically regardless of whether they come from the SDK or a manual
  implementation.
- ETag computation remains unchanged (MD5 hash of the object body).

# Status Transitions

- Proposed → Accepted: 2026-04-24, implementation completed in same PR.

# Implementation Notes

- Add `signV4(request, credentials, region, service)` helper to `r2object.ts`.
- Replace `S3Client` / `PutObjectCommand` with a `fetch()` PUT to
  `https://{accountId}.r2.cloudflarestorage.com/{bucket}/{key}` with signed
  headers.
- Replace `S3Client` / `DeleteObjectCommand` with a `fetch()` DELETE to the
  same endpoint pattern.
- Remove `@aws-sdk/client-s3` from `devDependencies` and `peerDependencies`.
- Remove any `await import("@aws-sdk/client-s3")` calls.
- Update barrel-guard and README to reflect the dependency removal.

# References

- AWS Signature Version 4: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html
- Cloudflare R2 S3 API compatibility: https://developers.cloudflare.com/r2/api/s3/api/
- ADR-014 (decouple R2 from WorkerSite): ./014-decouple-r2-from-workersite.md
- Issue #155: https://github.com/jmmaloney4/toolbox/issues/155
- PR #156: https://github.com/jmmaloney4/toolbox/pull/156

---
id: ADR-011
title: WorkerSite Extensions — Asset Upload, Redirects, Custom Worker, Optional Access Control
status: Proposed
date: 2026-03-15
deciders: [platform]
consulted: [web, infra]
tags: [design, adr, cloudflare, pulumi, workers, r2, workersite]
supersedes: []
superseded_by: []
links:
  - adr-005: ./005-cloudflare-workersite.md
  - cloudflare-r2-s3-compat: https://developers.cloudflare.com/r2/api/s3/api/
  - pulumi-dynamic: https://www.pulumi.com/docs/concepts/resources/dynamic-providers/
  - workers-custom-domains: https://developers.cloudflare.com/workers/platform/triggers/custom-domains/
---

# Context

- ADR-005 established the `WorkerSite` Pulumi component for hosting static sites on Cloudflare Workers with R2 storage and Zero Trust access control.
- The component has been in use but its current design blocks adoption for sites that:
  1. Need **declarative asset upload** as part of `pulumi up` (no wrangler/CI step).
  2. Need **domain-level redirects** (e.g., `www → apex` 301).
  3. Need a **custom worker script** (hand-authored TypeScript) instead of the generated one.
  4. Are **fully public** and do not need Zero Trust at all.
- The canonical downstream consumer, `deploy/www/cavinsresearch.io` in `cavinsresearch/zeus`, implemented all four features inline as a bespoke stack (ADRs 097 and 098 in that repo). The goal is to absorb those capabilities back into `sector7` so other consumers do not have to re-implement them.
- In scope:
  - New `R2Object` Pulumi dynamic resource (ported from `cavinsresearch.io`) for S3-compatible R2 CRUD.
  - `assets?` config block on `WorkerSite` (R2 token management + per-file upload).
  - `redirects?` config block on `WorkerSite` (injected into worker script or handled in custom worker).
  - `workerScript?` config block to supply a pre-built worker script content string instead of the generated one.
  - Making `accessControl?` optional (paths default to public-only when omitted, no Access Applications created).
  - Switching domain binding to `WorkersCustomDomain` as the default (instead of `WorkerDomain`).
- Out of scope:
  - SPA fallback, custom 404 pages, range requests (Phase 3 from ADR-005).
  - Migrating existing `WorkerSite` callers to the new API (migration path is provided but not automated).
  - Wrangler-based or CI-driven asset upload (callers can still do this externally).
  - KV backend (was Phase 2 option; R2 remains the only supported backend).

# Decision

Extend `WorkerSite` with four additive, optional capabilities, keeping the existing interface backward-compatible where feasible and documenting any breaking changes as a minor version bump.

## 1. R2Object Dynamic Resource

Extract the `R2Object` Pulumi dynamic resource from `cavinsresearch.io/r2object.ts` into `packages/sector7/workersite/r2object.ts`.

Key design constraints (all inherited from the original implementation):

- Provider callbacks MUST use inlined `require()` calls (not top-level imports) for `node:fs`, `node:crypto`, and `@aws-sdk/client-s3`. Pulumi serializes dynamic provider functions via V8 source capture; top-level native-module imports cannot be serialized and will throw at runtime.
- Change detection MUST use MD5 comparison against the stored ETag to avoid re-uploading unchanged files.
- Identity fields (`key`, `bucketName`, `accountId`, `accessKeyId`, `secretAccessKey`) MUST trigger replace on change.
- Content-type changes MUST trigger update (not replace).
- `deleteBeforeReplace: true` MUST be set for replace operations.

Public interface:

```typescript
interface R2ObjectInputs {
  accountId: Input<string>;
  bucketName: Input<string>;
  key: Input<string>;
  filePath: Input<string>;       // Local path read at deploy time
  contentType: Input<string>;
  accessKeyId: Input<string>;
  secretAccessKey: Input<string>;
}

class R2Object extends dynamic.Resource {
  readonly etag: Output<string>;
}
```

Add `@aws-sdk/client-s3` as a peer dependency (optional, required only when using asset upload).

## 2. Asset Upload (`assets?` on WorkerSiteArgs)

Add an optional `assets?` block. When present, `WorkerSite`:

1. Creates a `cloudflare.AccountToken` scoped to the R2 bucket with `R2_BUCKET_ITEM_WRITE` permission.
2. Derives S3-compatible credentials: `accessKeyId = token.id`, `secretAccessKey = SHA-256(token.value)` (per Cloudflare's spec).
3. Creates one `R2Object` resource per entry in `assets.files`.

```typescript
interface AssetFile {
  /** Local filesystem path to the file. */
  filePath: string;
  /** R2 object key (path within the bucket, e.g. "index.html"). */
  key: string;
  /** HTTP Content-Type header value. */
  contentType: string;
}

interface AssetConfig {
  /** Files to upload declaratively during pulumi up. */
  files: AssetFile[];
}
```

The R2 API token is managed internally by the component; callers do not supply credentials.

**Note on `resources` cast**: The Cloudflare provider TS types declare the `resources` field on `AccountTokenConditionsResources` as `Input<string>`, but the underlying API requires a JSON object. The constructor MUST cast via `as any` and document this discrepancy with a comment referencing the Cloudflare provider issue.

## 3. Redirect Support (`redirects?` on WorkerSiteArgs)

Add an optional `redirects?` array. When present and a `workerScript` is not supplied, the generated worker script is extended to check each redirect rule before serving assets.

```typescript
interface RedirectConfig {
  /** Hostname to redirect from (e.g. "www.example.com"). */
  from: string;
  /** Hostname to redirect to (e.g. "example.com"). */
  to: string;
  /** HTTP status code. @default 301 */
  status?: 301 | 302 | 307 | 308;
}
```

The redirect check is injected at the top of the fetch handler before cache lookup and R2 serving. When a custom `workerScript` is provided, `redirects` is ignored (the caller is responsible for redirect logic in their custom script).

## 4. Custom Worker Script (`workerScript?` on WorkerSiteArgs)

Add an optional `workerScript?` field. When present, its content is used verbatim as the Worker script instead of the generated script.

```typescript
interface WorkerScriptConfig {
  /** Compiled/transpiled Worker script content (ESM format). */
  content: Input<string>;
  /**
   * Additional plain_text bindings beyond R2_BUCKET and CACHE_TTL_SECONDS.
   * The caller is responsible for any redirect, domain, or custom logic.
   */
  extraBindings?: Array<{ name: string; value: Input<string> }>;
}
```

When `workerScript` is set, `redirects` is ignored. `R2_BUCKET` and `CACHE_TTL_SECONDS` bindings are still injected automatically; `extraBindings` adds additional plain_text bindings.

## 5. Optional Access Control

The current API requires `githubIdentityProviderId`, `githubOrganizations`, and `paths` even for fully public sites. This is unnecessary coupling.

Restructure so that:

- `paths` defaults to `[{ pattern: "/*", access: "public" }]` when omitted.
- `githubIdentityProviderId` and `githubOrganizations` become optional at the type level.
- Access Applications are created only when at least one path has `access: "github-org"`.
- When no `paths` include `github-org`, no ZeroTrustAccessApplications are created.

This is a **breaking change** to the TypeScript interface (both fields become optional), but is backward-compatible at runtime.

## 6. WorkersCustomDomain as Default

Replace `cloudflare.WorkerDomain` with `cloudflare.WorkersCustomDomain` as the default domain binding resource. `WorkersCustomDomain` is the current Cloudflare provider resource for custom domain routing and does not require a `zoneId` at the domain-binding level.

`zoneId` on `WorkerSiteArgs` becomes optional (only required if `manageDns: true`).

## Implementation Sequence

1. Extract `R2Object` → new file `packages/sector7/workersite/r2object.ts`; export from `workersite/index.ts`.
2. Make access control optional (type changes only, no behavior change for existing callers with `paths`).
3. Add `redirects?` + extend `generateWorkerScript()` to accept redirect rules.
4. Add `assets?` + R2 token management + per-file `R2Object` creation.
5. Add `workerScript?` + `extraBindings`.
6. Switch domain binding to `WorkersCustomDomain`; make `zoneId` optional.

# Consequences

## Positive

- `WorkerSite` becomes usable for fully public static sites without Zero Trust overhead.
- Asset upload is now declarative (`pulumi up` uploads changed files), eliminating the need for a separate wrangler/CI upload step.
- Custom worker scripts enable sites like `cavinsresearch.io` to use `WorkerSite` again, reducing duplicated infrastructure code.
- Redirect rules are first-class, covering the common `www → apex` pattern.
- `WorkersCustomDomain` aligns with the current Cloudflare provider API surface.

## Negative

- `WorkersCustomDomain` vs `WorkerDomain`: existing callers using `WorkerDomain` will require a state migration (resource aliases or `pulumi state rename`). This is a mild operational burden.
- Adding `@aws-sdk/client-s3` as a peer dep increases the install footprint for callers who don't use asset upload.
- The `as any` cast for `AccountToken.resources` is a known type-system paper cut; tracked until the upstream provider is fixed.

# Alternatives

## Option B — New `StaticSite` component (parallel to WorkerSite)

Create a separate `StaticSite` component targeting fully-public sites, with asset upload and redirects, while leaving `WorkerSite` unchanged.

- Pros: No risk of breaking existing `WorkerSite` callers; cleaner separation of concerns.
- Cons: Code duplication (Worker script generation, domain binding, DNS management); consumers must choose between two components; divergence over time.
- **Rejected**: The features are additive and optional; a single component with sane defaults is preferable.

## Option C — Thin wrapper in each consuming repo

Keep `sector7` unchanged; each consuming repo implements `R2Object`, redirects, and custom worker inline (current state).

- Pros: Zero changes to `sector7`; no coordination required.
- Cons: Duplicated infrastructure code across repos; known bugs must be fixed in multiple places; not idiomatic for a reusable component library.
- **Rejected**: The entire motivation for `sector7` is to avoid this pattern.

# Security / Privacy / Compliance

- The `AccountToken` for R2 upload MUST be scoped to a single bucket with `R2_BUCKET_ITEM_WRITE` permission only. No zone, account-level, or read permissions are granted.
- S3-compatible credentials are derived deterministically from the token (`secretAccessKey = SHA-256(token.value)`); they are never stored in plaintext in Pulumi state — only the ETag from uploaded objects is stored.
- Redirect logic does not expose any credentials or internal paths.

# Operational Notes

- Callers using asset upload will see one Pulumi resource per static file. For large sites (>100 files), this increases `pulumi up` plan time. Mitigate with `pulumi up --parallel`.
- The `AccountToken` is a tracked Pulumi resource; rotation requires `pulumi refresh` after the old token is revoked.
- Switching from `WorkerDomain` to `WorkersCustomDomain` requires either resource aliases or `pulumi state mv` to preserve state continuity. Callers should test in a non-production stack first.

# Status Transitions

- Amends ADR-005 (Cloudflare WorkerSite) by extending the component interface. ADR-005 remains valid for the existing Zero Trust access model; this ADR governs the new optional capabilities.

# Implementation Notes

- File locations: `packages/sector7/workersite/r2object.ts`, `worker-site.ts`, `worker-site-script.ts`, `index.ts`.
- Package version bump: minor (0.5.x → 0.6.0) given optional-ization of previously required fields.
- Add `@aws-sdk/client-s3 ^3.0.0` as an optional peer dependency.
- All new public APIs MUST have TSDoc comments with parameter descriptions and `@example` usage.

# References

- ADR-005: `./005-cloudflare-workersite.md`
- ADR-097 (zeus/sector7): `deploy/www/cavinsresearch.io` Worker+R2 site hosting decision
- ADR-098 (zeus/sector7): Worker TypeScript typecheck gate decision
- Cloudflare R2 S3-compatible API: https://developers.cloudflare.com/r2/api/s3/api/
- Pulumi dynamic providers: https://www.pulumi.com/docs/concepts/resources/dynamic-providers/
- Cloudflare token permission groups: https://developers.cloudflare.com/fundamentals/api/reference/permissions/

---
id: ADR-014
title: Decouple R2 From WorkerSite
status: proposed
date: 2026-04-24
---

# ADR 014: Decouple R2 From WorkerSite

*Date:* 2026-04-24
*Status:* proposed

**Related PRs:**

- Initial implementation: https://github.com/jmmaloney4/toolbox/pull/160
- Superseded draft: https://github.com/jmmaloney4/toolbox/pull/156

## Context

`WorkerSite` provisions the Cloudflare infrastructure needed to serve a static
site: the Worker script, custom domains, optional Access applications, and the
R2 bucket binding used by the Worker. Earlier ADR-014 work also added R2 object
uploads through `WorkerSiteArgs.assets`.

That shape made simple consumers convenient, but it coupled every
`@jmmaloney4/sector7/workersite` consumer to the R2 upload implementation. The
upload path is materially different from the infrastructure path:

- it creates a scoped Cloudflare `AccountToken` for R2 object writes;
- it uses Pulumi dynamic resources for object upload lifecycle management;
- it carries additional implementation and type dependencies that static-site
  infrastructure consumers should not inherit unless they opt in; and
- it has a separate operational failure mode from the Worker, domain, and Access
  resources.

PR #160 removed `assets` from `WorkerSiteArgs` and introduced an explicit
`uploadAssets()` API on `@jmmaloney4/sector7/workersite/r2`. That solved the
main transitive dependency problem, but the public import path still describes
R2 uploads as a `workersite` subfeature. This is misleading: R2 upload helpers
should be reusable R2 primitives that can be used with `WorkerSite`, but are not
owned by it.

## Decision

Keep `WorkerSite` infrastructure-only and move R2 upload APIs to a sibling
sector7 submodule:

```ts
import { WorkerSite } from "@jmmaloney4/sector7/workersite";
import { uploadAssets, uploadStaticAssets } from "@jmmaloney4/sector7/r2";
```

The `workersite` module remains responsible for serving infrastructure:

- Worker script generation;
- R2 bucket creation or binding;
- custom domain bindings;
- optional Cloudflare Access applications and identity provider wiring; and
- cache, redirect, and observability configuration.

The `r2` module owns upload concerns:

- scoped R2 write token creation;
- dynamic resources for object upload/update/delete;
- low-level asset upload APIs; and
- static-site upload convenience helpers.

`@jmmaloney4/sector7/workersite` must not re-export R2 upload symbols. Barrel
or package-export guards should enforce that boundary so future changes do not
accidentally pull R2 upload types back into the main WorkerSite import surface.

## API Shape

Retain the low-level upload API for callers that already have fully specified
object inputs:

```ts
uploadAssets("site-assets", {
  accountId,
  bucketName,
  files: [
    {
      key: "index.html",
      filePath: "/absolute/path/to/index.html",
      contentType: "text/html; charset=utf-8",
    },
  ],
  dependsOn: [site.worker],
}, { parent: site });
```

Add a convenience helper for the common static-site pattern where object keys
map directly to files under a base directory:

```ts
uploadStaticAssets("site-assets", {
  accountId,
  bucketName,
  basePath: staticSitePath,
  files: [
    { key: "index.html", contentType: "text/html; charset=utf-8" },
    { key: "styles.css", contentType: "text/css; charset=utf-8" },
    { key: "favicon.svg", contentType: "image/svg+xml" },
    { key: "robots.txt", contentType: "text/plain; charset=utf-8" },
  ],
  dependsOn: [site.worker],
}, { parent: site });
```

Do not add `site.uploadAssets()` to the `WorkerSite` class. An instance method
would make upload behavior part of the WorkerSite abstraction again, which is
the dependency boundary this ADR is trying to preserve.

The R2 helpers may be ergonomic, but they should remain explicit: consumers pass
`accountId`, `bucketName`, file descriptions, dependencies, and Pulumi resource
options. When a caller uses a `WorkerSite`, it can pass `site.bucket!.name` and
`{ parent: site }`, but the R2 module should not require `WorkerSite` as its
primary abstraction.

## Alternatives Considered

### 1. Keep uploads on `WorkerSiteArgs.assets`

This was the original convenient API.

Pros:

- Minimal consumer boilerplate.
- Single component owns site infrastructure and content upload.

Cons:

- Pulls upload dependencies into all WorkerSite consumers.
- Makes static infrastructure and object upload lifecycle failures inseparable.
- Makes the main `workersite` import surface responsible for R2 dynamic resource
  types.

Rejected because dependency boundaries matter more than saving a few lines at
the call site.

### 2. Keep the explicit API at `@jmmaloney4/sector7/workersite/r2`

This was the first decoupled shape from PR #160.

Pros:

- Avoids exporting R2 upload symbols from the main `workersite` barrel.
- Makes callers opt in to upload behavior.
- Small migration from the removed `assets` block.

Cons:

- The import path still implies R2 upload is a WorkerSite submodule.
- R2 upload primitives are less discoverable as reusable R2 utilities.
- Consumers may reasonably ask why a supposedly decoupled R2 module lives under
  `workersite`.

Rejected as an intermediate shape. It solves the type dependency problem but
not the conceptual boundary problem.

### 3. Move R2 uploads to `@jmmaloney4/sector7/r2`

Pros:

- Aligns package layout with the intended dependency graph.
- Keeps `WorkerSite` infrastructure-only.
- Makes R2 uploads reusable outside WorkerSite.
- Leaves the explicit opt-in import in place.

Cons:

- Requires one more consumer migration from the intermediate `workersite/r2`
  path.
- Requires package export and barrel-guard updates.

Accepted.

## Consequences

- Consumers using static asset uploads must import the R2 module explicitly.
- `WorkerSiteArgs` should not grow a replacement `assets` field.
- `@jmmaloney4/sector7/workersite/r2` should be removed before broad adoption,
  or kept only as a short compatibility shim if a release already exposed it.
  Prefer removal for now so stale consumers fail loudly and migrate to the
  correct boundary.
- The package should expose a sibling subpath export for `./r2`.
- Type-check guards should ensure R2 upload symbols are not exported from
  `./workersite`.
- Existing consumers such as `cavinsresearch/zeus` and `addendalabs/yard` should
  migrate directly from `WorkerSiteArgs.assets` to `@jmmaloney4/sector7/r2`, not
  to the intermediate `@jmmaloney4/sector7/workersite/r2` path.

## Implementation Notes

The follow-up implementation should:

1. Move the R2 upload source files from `packages/sector7/workersite/` to a
   sibling `packages/sector7/r2/` module, or otherwise expose them from that
   public subpath without re-exporting them through `workersite`.
2. Add `package.json` exports for `@jmmaloney4/sector7/r2`.
3. Remove or avoid the `@jmmaloney4/sector7/workersite/r2` export.
4. Add or update barrel guards so the main `workersite` barrel cannot re-export
   `uploadAssets`, `uploadStaticAssets`, `R2Object`, or related R2 upload types.
5. Add `uploadStaticAssets()` as the common static-site helper on the R2 module.
6. Migrate known consumers (`cavinsresearch/zeus`, `addendalabs/yard`) to the
   sibling `@jmmaloney4/sector7/r2` import path.

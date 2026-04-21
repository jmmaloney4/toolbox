---
id: ADR-013
title: ESM Worker Scripts and AccountToken Resources Type Mismatch
status: Accepted
date: 2026-04-21
deciders: [platform]
consulted: []
tags: [design, adr, cloudflare, pulumi, workers, sector7]
supersedes: []
superseded_by: []
links:
  - adr-005: ./005-cloudflare-workersite.md
  - adr-011: ./011-workersite-extensions.md
---

# Context

The `WorkerSite` component (ADR-005, extended by ADR-011) generates a Cloudflare Worker script and deploys it via `cloudflare.WorkersScript`. Two bugs prevented successful deployment when migrating `cavinsresearch.io` from hand-rolled Pulumi resources to the sector7 component:

1. **ESM script rejected**: The generated script uses `export default { async fetch(...) { ... } }` (ESM format). The Cloudflare REST API rejects this with `Unexpected token 'export'` unless the `hasModules` flag is set to `true` on the `WorkersScript` resource.

2. **AccountToken `resources` key format**: The Cloudflare API resource identifier for R2 buckets always uses `default` as the location segment (`com.cloudflare.edge.r2.bucket.{accountId}_default_{bucketName}`), regardless of the bucket's actual storage location (e.g. `ENAM`). Using the actual location produces the error `R2 Buckets are invalid`.

The hand-rolled `cavinsresearch.io` code avoided both issues by:
- Using esbuild (`--format=esm`) to compile a `.ts` worker file, piping stdout to `workerBuild.stdout` as script content. The compiled output presumably signaled ESM correctly.
- Hardcoding `_default_` as the location segment in the resources key.

# Decision

1. **Set `mainModule: "worker.js"`** on the `WorkersScript` resource. The generated script uses `export default { async fetch(...) { ... } }` (ESM format). The Cloudflare REST API needs an explicit signal to interpret the script as an ES module. The `hasModules` property is output-only in the Pulumi provider and cannot be set. Instead, `mainModule` (an input property) tells the API to treat the script as a module-syntax Worker.

2. **Use `JSON.stringify` with `default` location** for `AccountTokenPolicy.resources`. The Pulumi provider correctly types this as `Input<string>` (it's a JSON-encoded object serialized as a string). The resource key must use `default` as the location segment — using the bucket's actual location (e.g. `ENAM`) is rejected by the Cloudflare API.

# Consequences

## Positive

- No build step (esbuild, @pulumi/command) needed — the template already generates clean JS.
- One-line fix per issue; minimal diff, easy to review.
- `mainModule` is the documented Pulumi input property for module-syntax Workers.
- JSON.stringify with hardcoded `default` location matches proven production code.

## Negative

- The `default` location segment is undocumented Cloudflare behavior — if they change the API to use actual locations, this will break. Low risk given the existing production usage pattern.
- The resource key format is opaque and must be constructed exactly right; errors produce unhelpful messages like "R2 Buckets are invalid".

# Alternatives

- **esbuild build step** (as used in the old hand-rolled code): Pipe worker source through esbuild at deploy time via `command.local.Command`. This would strip TS and produce ESM output that may not need `hasModules`. Rejected because it adds `esbuild` and `@pulumi/command` as dependencies and introduces a build-time side effect inside a Pulumi program for no functional gain — our template already generates pure JS.

- **Service Worker format**: Rewrite the generated script to use `addEventListener("fetch", ...)` instead of `export default`. Rejected because it uses the legacy format and loses the cleaner ESM API (`request, env, ctx` parameters). ESM is the current Cloudflare standard.

- **Upstream provider type fix**: Open a PR on pulumi-cloudflare to fix the `resources` type from `Input<string>` to `Input<Record<string, string>>`. Would eliminate the JSON.stringify, but the Pulumi gRPC encoder requires a string at the wire level anyway.

# Security / Privacy / Compliance

- No changes to security posture. The `AccountToken` permission scoping is unchanged — only the serialization format of the `resources` field is corrected.

# Operational Notes

- Deployers may see a one-time diff on the `WorkersScript` resource adding `hasModules: true` when upgrading to this version.
- AccountToken resources will produce a diff as the serialized form changes from a JSON string to a plain object.

# Status Transitions

- New ADR.

# Implementation Notes

- Files changed:
  - `packages/sector7/workersite/worker-site.ts`: Add `mainModule: "worker.js"` to WorkersScript; change `resources` key to use `default` location segment with `JSON.stringify`.
  - `packages/sector7/tests/worker-site.test.ts`: Revert test to expect JSON.stringify output with `default` location.
- No new dependencies.
- Downstream consumers (`cavinsresearch.io`) update via lockfile bump (`pnpm update @jmmaloney4/sector7`).

# References

- Hand-rolled reference: `cavinsresearch/zeus` commit `87258040` (`deploy/www/cavinsresearch.io/index.ts`)
- Pulumi Cloudflare `WorkersScript.hasModules`: `@pulumi/cloudflare` v6.12.0 `workersScript.d.ts` line 169
- Cloudflare Workers ESM format: https://developers.cloudflare.com/workers/reference/how-workers-works/

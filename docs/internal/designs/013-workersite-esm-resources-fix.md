---
id: ADR-013
title: ESM Worker Scripts and AccountToken Resources Type Mismatch
status: Proposed
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

2. **AccountToken `resources` type mismatch**: The Pulumi TypeScript type for `AccountTokenPolicy.resources` declares `Input<string>`, but the underlying Cloudflare provider actually expects a plain JSON object (e.g., `{ "com.cloudflare.edge.r2.bucket.xxx": "*" }`). Passing a `JSON.stringify()`'d string produces the error `R2 Buckets are invalid`.

The hand-rolled `cavinsresearch.io` code avoided both issues by:
- Using esbuild (`--format=esm`) to compile a `.ts` worker file, piping stdout to `workerBuild.stdout` as script content. The compiled output presumably signaled ESM correctly.
- Using `as any` to pass a plain object for `resources`, bypassing the type checker.

# Decision

1. **Set `hasModules: true`** on the `WorkersScript` resource. The generated script is valid ESM JavaScript (no TypeScript syntax, no type annotations). The `hasModules` flag tells the Cloudflare API to interpret the script as an ES module, which is the correct and intended format. This is a one-line additive change with no build step required.

2. **Pass a plain object cast with `as unknown as string`** for `AccountTokenPolicy.resources`. The cast matches the pattern used in the proven hand-rolled code and correctly communicates intent: the provider type is wrong, not our usage. A comment explaining the mismatch is included at the call site.

# Consequences

## Positive

- No build step (esbuild, @pulumi/command) needed — the template already generates clean JS.
- One-line fix per issue; minimal diff, easy to review.
- `hasModules` is the official Cloudflare API mechanism for ESM workers.
- Plain object pattern for `resources` matches proven production code.

## Negative

- `as unknown as string` is a type-system escape hatch; the real fix should be in the Pulumi Cloudflare provider's type definitions.
- If the provider ever starts validating the string type at runtime, this cast would break. Low risk — the provider has always accepted objects here.

# Alternatives

- **esbuild build step** (as used in the old hand-rolled code): Pipe worker source through esbuild at deploy time via `command.local.Command`. This would strip TS and produce ESM output that may not need `hasModules`. Rejected because it adds `esbuild` and `@pulumi/command` as dependencies and introduces a build-time side effect inside a Pulumi program for no functional gain — our template already generates pure JS.

- **Service Worker format**: Rewrite the generated script to use `addEventListener("fetch", ...)` instead of `export default`. Rejected because it uses the legacy format and loses the cleaner ESM API (`request, env, ctx` parameters). ESM is the current Cloudflare standard.

- **Upstream provider type fix**: Open a PR on pulumi-cloudflare to fix the `resources` type from `Input<string>` to `Input<Record<string, string>>`. Correct long-term fix but out of scope for unblocking deployment now.

# Security / Privacy / Compliance

- No changes to security posture. The `AccountToken` permission scoping is unchanged — only the serialization format of the `resources` field is corrected.

# Operational Notes

- Deployers may see a one-time diff on the `WorkersScript` resource adding `hasModules: true` when upgrading to this version.
- AccountToken resources will produce a diff as the serialized form changes from a JSON string to a plain object.

# Status Transitions

- New ADR.

# Implementation Notes

- Files changed:
  - `packages/sector7/workersite/worker-site.ts`: Add `hasModules: true` to WorkersScript; change `resources` from `JSON.stringify(obj)` to `obj as unknown as string`.
  - `packages/sector7/tests/worker-site.test.ts`: Update test assertion to expect plain object instead of JSON string.
- No new dependencies.
- Downstream consumers (`cavinsresearch.io`) update via lockfile bump (`pnpm update @jmmaloney4/sector7`).

# References

- Hand-rolled reference: `cavinsresearch/zeus` commit `87258040` (`deploy/www/cavinsresearch.io/index.ts`)
- Pulumi Cloudflare `WorkersScript.hasModules`: `@pulumi/cloudflare` v6.12.0 `workersScript.d.ts` line 169
- Cloudflare Workers ESM format: https://developers.cloudflare.com/workers/reference/how-workers-works/

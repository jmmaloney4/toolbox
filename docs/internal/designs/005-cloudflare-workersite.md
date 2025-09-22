---
id: ADR-005
title: Cloudflare WorkerSite Static Hosting with Zero Trust by Subpath (Pulumi Component)
status: Proposed
date: 2025-09-22
deciders: [platform]
consulted: [security, web, infra]
tags: [design, adr, cloudflare, pulumi, workers, access, zero-trust]
supersedes: []
superseded_by: []
links:
  - cloudflare-workers: https://developers.cloudflare.com/workers/
  - cloudflare-access: https://developers.cloudflare.com/cloudflare-one/policies/access/
  - pulumi-cloudflare: https://www.pulumi.com/registry/packages/cloudflare/
  - worker-domains: https://developers.cloudflare.com/workers/platform/triggers/custom-domains/
  - worker-routes: https://developers.cloudflare.com/workers/platform/triggers/routes/
---

# Context
- We want a reusable Pulumi ComponentResource to provision Cloudflare-hosted static websites on the Workers platform, not Pages.
- The component MUST bind one or more custom domains and configure Cloudflare Zero Trust (Access) with path-level policies so that some paths (e.g., `/blog/*`) are public while others (e.g., `/research/*`) are restricted to members of specific GitHub organizations.
- Drivers:
  - Strategic shift: prefer Cloudflare Workers as the unified runtime for static and dynamic needs.
  - Security baseline: managed Zero Trust with identity- and org-based controls.
  - Reusability: ship a typed component under `packages/toolbox/pulumi/` with clear inputs/outputs and an example.
- In scope:
  - Worker deployment for static assets (R2- or KV-backed, with cache and directory index handling).
  - Domain binding using Worker Custom Domains when available, otherwise Worker Routes per zone.
  - Cloudflare Access Applications and Policies per subpath, including GitHub organization allow‑lists.
- Out of scope:
  - Authoring the site content or build pipeline (callers provide an artifact path or repo build via CI).
  - Creating the GitHub Access Identity Provider in Cloudflare (assumed to exist; the component accepts its ID).

# Decision
1) Build a Pulumi TypeScript ComponentResource named `WorkerSite` that:
   - Hosts static assets from R2 (default) or KV (optional) and serves them via a Worker script.
   - Binds one or more domains either via Worker Custom Domains (preferred) or Worker Routes fallback.
   - Configures Cloudflare Zero Trust on a per‑subpath basis by creating Access Applications and Policies.

2) Access model:
   - For each protected path pattern (e.g., `/research/*`), create an Access Application targeting the primary domain and subpath. Where provider support allows, set `domain: "<hostname><path-pattern>"` (e.g., `site.example.com/research/*`). If path scoping at the application level is not supported or proves unreliable, create distinct applications per path and apply policies accordingly.
   - Public paths (e.g., `/blog/*`) are modeled as an Access Application with a policy that `include: everyone` (permit-all), ensuring consistency of audit and future policy constraints.
   - Restricted paths use `include: github` with the specified `identity_provider_id` and one or more organization names. Additional `require` conditions (e.g., device posture) MAY be supported later.

3) Domains:
   - Prefer Worker Custom Domains where available in the provider. If unavailable or constrained, use Worker Routes with zone patterns (e.g., `site.example.com/*`).
   - DNS is assumed to be on Cloudflare nameservers; explicit `Record` resources are not required when using Routes. If Custom Domains require or benefit from explicit DNS, the component MAY ensure records when `manageDns: true`.

4) Assets:
   - Default backend is R2 with an object key prefix matching the site root. The Worker uses R2 bindings and edge caching to serve assets, supports directory index (`index.html`) and optional SPA fallback.
   - For small sites, a KV backend MAY be chosen. Large binaries and big bundles SHOULD use R2.

5) Inputs/Outputs:
   - The component accepts `accountId`, `zoneId` (for routes), `domains[]`, storage choice and bucket/namespace names, and a `paths[]` policy map with `public` vs `github-org` access.
   - It outputs the Worker name, bound domains, Access Application/Policy IDs, and the storage location (bucket/namespace).

# Consequences
## Positive
- Unified hosting on Workers supports future dynamic needs without replatforming.
- Path‑level Zero Trust provides granular access aligned to team/org boundaries.
- Reusable Pulumi interface reduces copy‑paste configs across repos.
- Clear separation between infra (provisioning) and CI (build/upload of assets).

## Negative
- Slightly higher initial complexity than Pages; additional bindings and script logic.
- Provider/API drift risk for Worker Custom Domains and Access path scoping semantics.
- Managing R2/KV contents requires a CI/upload process (out of scope for this ADR).

# Alternatives
- Cloudflare Pages + Access per subpath:
  - Pros: Simpler deploys with Pages projects and built‑in static hosting.
  - Cons: Diverges from Workers‑first strategy; separate product surface.
- Worker + reverse proxy in front of Pages:
  - Pros: Keep Pages simplicity but layer Workers flexibility.
  - Cons: More moving parts, latency overhead, operational complexity.
- DIY auth in Worker (validate CF Access JWT or custom OIDC):
  - Pros: Full control.
  - Cons: Reinvents Access; higher security burden.

# Security / Privacy / Compliance
- Use least‑privilege Cloudflare API tokens:
  - Required: Account → Workers Scripts: Edit; R2: Edit (if creating buckets); Zero Trust Access: Edit.
  - Optional: Zone → DNS: Edit (only if managing explicit records).
- No secrets are embedded in the Worker; bindings use Cloudflare‑managed credentials.
- The GitHub IdP MUST exist in the account; we pass its `identity_provider_id` and constrain org membership in policies.
- Log access decisions via Cloudflare Access; do not store PII in logs.

# Operational Notes
- Cost: Workers and R2 pricing apply; cache effectiveness impacts egress.
- Limits: Worker CPU/runtime limits and R2 request rates; size large assets appropriately.
- Observability: Use Request CF‑Ray IDs, Access logs, and add minimal logging in the Worker for cache misses.
- Rollouts/backouts: Version the Worker script; safe to roll back by re‑deploying prior asset manifest and script.

# Status Transitions
- New ADR; no supersessions.

# Implementation Notes
- Package: `packages/toolbox/pulumi/` exports `WorkerSite` as a ComponentResource.
- Resources (indicative; subject to provider version):
  - `cloudflare.R2Bucket` (or reuse existing)
  - `cloudflare.WorkerScript` with `r2BucketBindings` or `kvNamespaceBindings`
  - `cloudflare.WorkerDomain` (preferred) or `cloudflare.WorkerRoute` per domain
  - `cloudflare.AccessApplication` per subpath/domain target
  - `cloudflare.AccessPolicy` per application (public vs GitHub org)
  - Optional: `cloudflare.Record` when `manageDns: true` and Custom Domains require DNS
- CI uploads assets to R2/KV and bumps a content hash used by the Worker for cache busting.

# References
- Cloudflare Workers: custom domains and routes
- Cloudflare Access: applications and policy rules (GitHub org includes)
- Pulumi Cloudflare provider: Workers, R2, Access resources

---

## Appendix A — Component API (TypeScript sketch)

```ts
export interface WorkerSiteArgs {
  accountId: pulumi.Input<string>;
  zoneId?: pulumi.Input<string>; // required when using routes

  // Worker & assets
  name: pulumi.Input<string>;
  assets: {
    backend: "r2" | "kv";
    r2?: { bucketName: pulumi.Input<string>; create?: pulumi.Input<boolean>; prefix?: pulumi.Input<string>; };
    kv?: { namespace: pulumi.Input<string>; create?: pulumi.Input<boolean>; prefix?: pulumi.Input<string>; };
    spaFallback?: pulumi.Input<boolean>;
    directoryIndex?: pulumi.Input<string>; // default "index.html"
    cacheTtlSeconds?: pulumi.Input<number>;
  };

  // Domains
  domains: pulumi.Input<string>[]; // e.g., ["site.example.com"]
  preferWorkerDomains?: pulumi.Input<boolean>; // default true
  manageDns?: pulumi.Input<boolean>; // default false

  // Zero Trust
  githubIdentityProviderId: pulumi.Input<string>;
  githubOrganizations: pulumi.Input<string>[]; // one or more orgs
  paths: Array<{
    pattern: pulumi.Input<string>; // "/blog/*", "/research/*"
    access: "public" | "github-org";
  }>;
}

export interface WorkerSiteOutputs {
  workerName: pulumi.Output<string>;
  boundDomains: pulumi.Output<string[]>;
  storage: pulumi.Output<{ backend: "r2" | "kv"; bucketName?: string; namespace?: string; prefix?: string }>;
  accessApplications: pulumi.Output<string[]>; // IDs
  accessPolicies: pulumi.Output<string[]>; // IDs
}
```

## Appendix B — Resource Model and Flow
- Create or reference storage (R2/KV) according to `assets.backend`.
- Deploy `WorkerScript` that:
  - Resolves the request path to an object key with `prefix` and `directoryIndex` handling.
  - Serves from cache and R2/KV; applies SPA fallback when enabled.
- Bind the Worker to traffic:
  - If `preferWorkerDomains`, create `WorkerDomain` per hostname; otherwise create `WorkerRoute` patterns (`host/*`).
- For each `paths[*]` entry:
  - Create an `AccessApplication` targeting `<host><pattern>` (or a per-path app if required by provider semantics).
  - Create an `AccessPolicy` with:
    - `public`: `include: [{ everyone: true }]`
    - `github-org`: `include: [{ github: { identity_provider_id: <id>, name: <org> } }]`
  - Order by declaration to set policy/application precedence as needed.

## Appendix C — Implementation Plan
- Phase 1 (MVP)
  - Component scaffold and minimal R2-backed Worker that serves static assets.
  - Bind one domain via `WorkerRoute` (broadest compatibility).
  - Single public path (`/blog/*`) and single restricted path (`/research/*`).
- Phase 2
  - Add `WorkerDomain` support and optional DNS management flag.
  - Multiple domains and multiple path policies.
  - KV backend option.
- Phase 3
  - Cache control knobs and observability (cf-ray echo, cache status headers).
  - SPA routing helpers and not-found strategies.

## Appendix D — Risks & Mitigations
- Provider drift for `WorkerDomain` and Access path targeting
  - Mitigation: feature-flag to use Routes; create per-path Applications if domain+path isn’t supported.
- Large asset sets impact R2 request costs and latency
  - Mitigation: edge cache with long TTLs and content hashing.
- Incorrect Access policy order yields unintended exposure
  - Mitigation: explicit precedence; smoke tests for public vs private paths.

## Appendix E — Test Strategy
- Unit: construct graph with Pulumi preview for representative inputs; assert resource counts and key properties.
- Integration: deploy to a test zone with sample assets; verify domain binding, cache behavior, and Access flows.
- Security: validate GitHub org gating; confirm `/blog/*` public and `/research/*` protected.

## Appendix F — Example Usage (illustrative)

```ts
const site = new WorkerSite("docs-site", {
  accountId,
  zoneId,
  name: "docs-site",
  assets: { backend: "r2", r2: { bucketName: "docs-site", create: true, prefix: "public/" }, spaFallback: false },
  domains: ["site.example.com"],
  preferWorkerDomains: true,
  githubIdentityProviderId: cfGithubIdpId,
  githubOrganizations: ["acme-org"],
  paths: [
    { pattern: "/blog/*", access: "public" },
    { pattern: "/research/*", access: "github-org" },
  ],
});
```

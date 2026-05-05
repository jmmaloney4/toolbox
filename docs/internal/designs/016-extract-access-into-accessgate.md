---
id: ADR-016
title: Extract Access Provisioning Into Standalone AccessGate Component
status: Proposed
date: 2026-05-05
deciders: [jmmaloney4]
tags: [design, adr]
supersedes: []
superseded_by: []
links: [ADR-011, ADR-014]
---

# Context

`WorkerSite` bundles Cloudflare Zero Trust Access provisioning (identity provider
creation, per-path Access Applications with inline policies) alongside its core
Worker + R2 + custom domain infrastructure. This coupling prevents reuse of the
Access provisioning logic for origins that are not Cloudflare Workers — for
example, services behind a Cloudflare Tunnel that need Zero Trust auth but have
no Worker or R2 bucket.

The pattern is the same dependency boundary issue that ADR-014 identified for
R2 uploads: a subset of `WorkerSite` functionality is broadly useful on its own,
but coupling it to `WorkerSite` forces consumers to accept the entire Worker
abstraction just to get Access Applications.

Concrete use cases:

- A GKE-hosted dashboard (Lens) behind a Cloudflare Tunnel that needs GitHub
  org-based access control before the request reaches the cluster.
- Any tunnel-backed or externally-hosted origin that should be gated by
  Cloudflare Zero Trust.

# Decision

Extract the Access provisioning logic from `WorkerSite` into a standalone
`AccessGate` ComponentResource at `@jmmaloney4/sector7/access`.

```ts
import { AccessGate } from "@jmmaloney4/sector7/access";
```

The `AccessGate` component owns:

- GitHub OAuth Identity Provider auto-creation (`ZeroTrustAccessIdentityProvider`).
- Per (domain, path) `ZeroTrustAccessApplication` creation with inline policies.
- Validation of github-org requirements (identity provider, organizations).
- Configurable session duration and application type.

`WorkerSite` will delegate its Access provisioning to `AccessGate` internally.
The `WorkerSite` public API (args, outputs) remains unchanged — this is an
internal refactoring, not a breaking change.

# API Shape

```ts
const gate = new AccessGate("lens-access", {
  accountId: "abc123",
  zoneId: "xyz789",
  name: "lens",
  domains: ["lens.example.com"],
  paths: [{ pattern: "/*", access: "github-org" }],
  githubOAuthConfig: {
    clientId: "Ov23li...",
    clientSecret: pulumi.secret("abc123..."),
  },
  githubOrganizations: ["my-org"],
});
```

The `AccessPathConfig` and `AccessGithubOAuthConfig` types are defined on the
`access` module and re-exported from there. `WorkerSite` re-uses these types
internally (its existing `PathConfig` and `GithubOAuthConfig` become type aliases
or are replaced by direct references to the access module types).

# Alternatives Considered

### 1. Copy Access logic at each call site

Pros:
- No new abstraction, no package changes.

Cons:
- Duplicated validation, IDP creation, and policy wiring.
- Divergent behavior across call sites.
- Every new consumer reimplements the same Cloudflare Access API patterns.

Rejected because the Access provisioning logic has enough moving parts (IDP
creation, validation, policy include construction, naming) that copy-paste will
drift.

### 2. Keep Access on WorkerSite, add a "null Worker" mode

Pros:
- Single component, no new sub-path.

Cons:
- `WorkerSite` would need to accept optional Worker/R2 config, making its API
  confusing and its validation complex.
- The component name ("WorkerSite") would be misleading for non-Worker origins.
- Tests become harder to reason about — is it a Worker site or just Access?

Rejected because bending WorkerSite to serve a non-Worker use case undermines
its clarity.

### 3. Extract into `@jmmaloney4/sector7/access` (accepted)

Pros:
- Reusable for any Cloudflare-hosted origin (Workers, Tunnels, Pages, etc.).
- Clean dependency boundary — Access consumers don't pull Worker/R2 types.
- Follows the ADR-014 pattern (sibling sub-path export).
- WorkerSite delegates internally, preserving its public API.

Cons:
- Requires package export and barrel-guard updates.
- WorkerSite constructor gains one internal delegation step.

Accepted. The dependency boundary is correct, the pattern is established by
ADR-014, and the internal refactoring is low-risk.

# Consequences

## Positive

- Access provisioning is reusable for any origin type.
- WorkerSite remains focused on Worker + R2 + domain concerns.
- The `access` module has zero dependency on Worker or R2 types.
- New consumers (tunnel-backed services, external origins) can adopt Zero Trust
  without the WorkerSite abstraction.

## Negative

- One more sub-path export to maintain in package.json.
- WorkerSite internals change (delegation to AccessGate) — behavior is
  identical, but the parent component changes from WorkerSite to AccessGate.
  AccessGate uses `aliases: [{ parent: opts.parent }]` to preserve existing
  URNs when delegated from WorkerSite.

# Security / Privacy / Compliance

- AccessGate creates `ZeroTrustAccessIdentityProvider` and
  `ZeroTrustAccessApplication` resources with the same security posture as the
  existing WorkerSite Access logic.
- GitHub OAuth client secrets remain Pulumi secrets throughout.

# Operational Notes

- Existing WorkerSite deployments will see no change in provisioned resources.
  AccessGate adds `aliases: [{ parent: opts.parent }]` so that when WorkerSite
  delegates, the child resources retain their old URNs (parented under
  WorkerSite). No destroy-and-recreate.
- Standalone AccessGate usage (no parent) creates resources with AccessGate as
  parent — no alias needed since there is no prior state.
- Resource logical names use array indices (`app-d0-p0`) because Pulumi
  requires resource names to be plain strings known at plan time. The
  Cloudflare display names already include domain + path for readability.

# Status Transitions

- Extends the separation-of-concerns pattern established by ADR-014.

# Implementation Notes

1. Create `packages/sector7/access/` with `AccessGate` ComponentResource.
2. Add `./access` sub-path export to `package.json`.
3. Add barrel guard ensuring Access types are not re-exported from `./workersite`.
4. Refactor `WorkerSite` to delegate Access creation to `AccessGate` internally.
5. Preserve `WorkerSite` public API (args, outputs) — no breaking changes.
6. Add dedicated tests for `AccessGate` standalone usage.
7. Verify existing `WorkerSite` tests still pass unchanged.

# References

- ADR-011: WorkerSite extensions (originally added Access support)
- ADR-014: Decouple R2 from WorkerSite (established sibling sub-path pattern)

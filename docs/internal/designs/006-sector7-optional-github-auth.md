# ADR-006: GitHub Authentication and Per-Path Access Control in sector7 WorkerSite

## Status

Accepted

## Context

The `WorkerSite` component in `@jmmaloney4/sector7` initially required a pre-configured GitHub Identity Provider ID even when all paths are set to public access. Through implementation and testing, we've gained important insights about how Cloudflare Access Identity Providers work and how to best structure the component.

### Current Problems

1. **Required for public sites**: `githubIdentityProviderId` and `githubOrganizations` were required parameters even when no paths use `github-org` access
2. **Single organization list**: All paths with `github-org` access share the same organization list, preventing granular per-path control
3. **IDP wrapped in component**: Initial design auto-created IDPs within WorkerSite, but this is unnecessary given IDP capabilities

### Key Insights About GitHub IDPs

Through implementation, we learned several important facts about Cloudflare Access Identity Providers:

1. **IDPs are organization-agnostic**: A GitHub IDP is just an OAuth integration with GitHub. It doesn't "represent" any specific organization.
2. **Organization filtering happens in policies**: The organization membership requirement is enforced in the Access Policy, not the IDP.
3. **One IDP can serve many organizations**: A single GitHub IDP can be used across multiple sites with different organization requirements.
4. **IDPs are sharable**: The same IDP can be shared across multiple WorkerSites, multiple stacks (via stack references), and even used outside of WorkerSite entirely.
5. **IDP creation is simple**: Creating a `cloudflare.ZeroTrustAccessIdentityProvider` is a single Pulumi resource - no need to wrap it.

### Constraints

- Must maintain backward compatibility with existing usage patterns
- Must only require GitHub configuration when actually needed for authentication
- Should support granular per-path organization control
- Should support IDP sharing across stacks via stack references
- Should not wrap simple Cloudflare resources unnecessarily

### Related Work

This issue was discovered while setting up the `theoretical-edge` Quarto blog hosting, where a simple public site required unnecessary GitHub OAuth configuration.

## Decision

We will enhance the `WorkerSite` component with conditional GitHub authentication and per-path organization control:

### Core Principles

1. **No IDP wrapping**: WorkerSite will NOT create GitHub IDPs. Users create IDPs separately using `cloudflare.ZeroTrustAccessIdentityProvider`.
2. **IDP sharing encouraged**: A single GitHub IDP can be shared across multiple WorkerSites and stacks.
3. **Conditional requirements**: GitHub IDP is only required when at least one path uses `github-org` access.
4. **Per-path granularity**: Each path can specify its own list of allowed GitHub organizations.

### Implementation Requirements

The component MUST:

- Make `githubIdentityProviderId` optional (required only when paths need it)
- Remove top-level `githubOrganizations` parameter
- Add per-path `organizations` field to `PathConfig`
- Validate that paths with `github-org` access specify at least one organization
- Validate that `githubIdentityProviderId` is provided when any path uses `github-org` access
- Support stack references for IDP sharing across stacks

### API Design

```typescript
interface PathConfig {
  /** Path pattern (e.g., "/blog/*", "/research/*") */
  pattern: pulumi.Input<string>;

  /** Access level for this path */
  access: "public" | "github-org";

  /**
   * GitHub organizations allowed to access this path.
   * Required when access is "github-org".
   * Members of ANY of these organizations will be granted access (OR logic).
   */
  organizations?: pulumi.Input<string>[];
}

interface WorkerSiteArgs {
  // ... existing args (accountId, zoneId, name, domains, r2Bucket, etc.) ...

  /**
   * GitHub Identity Provider ID for authentication.
   * Optional - only required when at least one path uses "github-org" access.
   *
   * Can be:
   * - Direct IDP ID: `myGithubIdp.id`
   * - Stack reference: `stackRef.getOutput("githubIdpId")`
   */
  githubIdentityProviderId?: pulumi.Input<string>;

  /** Path access configurations with per-path organization control */
  paths: PathConfig[];
}
```

### Validation Logic

```typescript
const pathsNeedingAuth = args.paths.filter(p => p.access === "github-org");

if (pathsNeedingAuth.length > 0) {
  // Ensure IDP is provided
  if (!args.githubIdentityProviderId) {
    throw new Error(
      "githubIdentityProviderId required when using 'github-org' access"
    );
  }

  // Ensure each path has organizations
  for (const path of pathsNeedingAuth) {
    if (!path.organizations || path.organizations.length === 0) {
      throw new Error(
        `Path "${path.pattern}" has access "github-org" but no organizations specified`
      );
    }
  }
}
```

### Scope

**In scope:**
- Conditional GitHub IDP requirement based on path access configuration
- Per-path organization control for granular access management
- IDP sharing across multiple WorkerSites and stacks
- Backward compatibility with existing usage

**Out of scope:**
- Auto-creation of GitHub IDPs (users manage IDPs separately)
- Support for identity providers other than GitHub
- Migration tooling for existing deployments
- AND logic for organization membership (only OR is supported within a path)

## Consequences

### Benefits

- **Reduced friction**: Public sites require no GitHub setup
- **Granular control**: Each path can specify different organization requirements
- **IDP reusability**: One IDP serves multiple sites, organizations, and stacks
- **Simpler component**: WorkerSite doesn't manage IDP lifecycle, clearer separation of concerns
- **Stack references**: IDPs can be created in infrastructure stacks and referenced by application stacks
- **Better defaults**: Only requires configuration when actually needed
- **Improved DX**: Clear error messages guide users to correct configuration

### Trade-offs

- **Separate IDP creation**: Users must create IDPs separately (but this is simple and reusable)
- **Per-path configuration**: More verbose for sites with many paths (but more powerful)
- **More validation logic**: Need to validate per-path organizations are specified
- **Documentation burden**: Need to document IDP creation and sharing patterns

### Risks & Mitigations

- **Risk**: Users might not understand IDP sharing capabilities
  - **Mitigation**: Provide comprehensive examples showing single-stack, multi-stack, and stack-reference patterns

- **Risk**: Users might create unnecessary duplicate IDPs
  - **Mitigation**: Document that one IDP can serve all organizations and sites; provide reuse examples

- **Risk**: Breaking changes for existing users
  - **Mitigation**: This is still in active development; no published version exists yet

## Alternatives Considered

### Alternative A — Keep GitHub Config Always Required

- **Pros**: Simpler implementation, no API changes needed
- **Cons**: Continues to create friction for simple public sites
- **Why not chosen**: Doesn't solve the core problem; setup friction remains

### Alternative B — Separate Components for Public vs. Authenticated Sites

- **Pros**: Clear separation of concerns, simpler individual components
- **Cons**: Code duplication, confusing for users which component to use, migration difficulty
- **Why not chosen**: Adds unnecessary complexity at the wrong level

### Alternative C — Auto-Create IDP Within WorkerSite

- **Pros**: One-stop component, no external dependencies
- **Cons**: Prevents IDP sharing, creates unnecessary coupling, limits reusability
- **Why not chosen**: IDPs are organization-agnostic and should be shared; wrapping a simple resource adds no value

### Alternative D — Top-Level Organizations with Per-Path Override

- **Pros**: Less verbose for sites with uniform access
- **Cons**: Two ways to configure the same thing, validation complexity, unclear precedence
- **Why not chosen**: Simpler to have one clear pattern; per-path is more explicit and powerful

## Usage Examples

### Example 1: Public-Only Site

```typescript
import { WorkerSite } from "@jmmaloney4/sector7";

const publicSite = new WorkerSite("blog", {
  accountId: "...",
  zoneId: "...",
  domains: ["blog.example.com"],
  r2Bucket: { bucketName: "blog-assets", create: true },
  paths: [
    { pattern: "/*", access: "public" },  // No GitHub config needed!
  ],
});
```

### Example 2: Single Stack with IDP and WorkerSite

```typescript
import * as cloudflare from "@pulumi/cloudflare";
import { WorkerSite } from "@jmmaloney4/sector7";

const config = new pulumi.Config();

// Create GitHub IDP once
const githubIdp = new cloudflare.ZeroTrustAccessIdentityProvider("github-idp", {
  accountId: config.require("cloudflareAccountId"),
  name: "GitHub",
  type: "github",
  configs: [{
    clientId: config.requireSecret("githubClientId"),
    clientSecret: config.requireSecret("githubClientSecret"),
  }],
});

// Use IDP in WorkerSite with per-path organization control
const internalSite = new WorkerSite("internal-docs", {
  accountId: config.require("cloudflareAccountId"),
  zoneId: config.require("cloudflareZoneId"),
  domains: ["internal.example.com"],
  r2Bucket: { bucketName: "internal-docs", create: true },
  githubIdentityProviderId: githubIdp.id,
  paths: [
    { pattern: "/public/*", access: "public" },  // Anyone
    { pattern: "/engineering/*", access: "github-org", organizations: ["my-org-engineering"] },
    { pattern: "/leadership/*", access: "github-org", organizations: ["my-org-leadership"] },
    { pattern: "/shared/*", access: "github-org", organizations: ["my-org-engineering", "my-org-leadership"] },
  ],
});

// Export IDP ID for use in other stacks
export const githubIdpId = githubIdp.id;
```

### Example 3: IDP Sharing Across Multiple Sites (Same Stack)

```typescript
import * as cloudflare from "@pulumi/cloudflare";
import { WorkerSite } from "@jmmaloney4/sector7";

// One IDP for all sites
const githubIdp = new cloudflare.ZeroTrustAccessIdentityProvider("github-idp", {
  accountId: accountId,
  name: "GitHub",
  type: "github",
  configs: [{ clientId: "...", clientSecret: "..." }],
});

// Site 1: Engineering org only
const engineeringSite = new WorkerSite("engineering-site", {
  accountId: accountId,
  zoneId: zoneId,
  domains: ["engineering.example.com"],
  r2Bucket: { bucketName: "engineering-site", create: true },
  githubIdentityProviderId: githubIdp.id,  // Shared IDP
  paths: [
    { pattern: "/*", access: "github-org", organizations: ["my-org-engineering"] },
  ],
});

// Site 2: Different org, same IDP
const marketingSite = new WorkerSite("marketing-site", {
  accountId: accountId,
  zoneId: zoneId,
  domains: ["marketing.example.com"],
  r2Bucket: { bucketName: "marketing-site", create: true },
  githubIdentityProviderId: githubIdp.id,  // Same IDP, different orgs!
  paths: [
    { pattern: "/*", access: "github-org", organizations: ["my-org-marketing"] },
  ],
});
```

### Example 4: IDP Sharing Across Stacks via Stack References

**Infrastructure Stack** (`infra/index.ts`):
```typescript
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

// Create shared GitHub IDP in infrastructure stack
const githubIdp = new cloudflare.ZeroTrustAccessIdentityProvider("github-idp", {
  accountId: config.require("cloudflareAccountId"),
  name: "GitHub - Shared",
  type: "github",
  configs: [{
    clientId: config.requireSecret("githubClientId"),
    clientSecret: config.requireSecret("githubClientSecret"),
  }],
});

// Export for other stacks
export const githubIdpId = githubIdp.id;
export const cloudflareAccountId = config.require("cloudflareAccountId");
export const cloudflareZoneId = config.require("cloudflareZoneId");
```

**Application Stack** (`app/index.ts`):
```typescript
import * as pulumi from "@pulumi/pulumi";
import { WorkerSite } from "@jmmaloney4/sector7";

// Reference infrastructure stack
const infraStack = new pulumi.StackReference("infra", {
  name: "organization/infra/production",
});

const site = new WorkerSite("app-site", {
  accountId: infraStack.getOutput("cloudflareAccountId"),
  zoneId: infraStack.getOutput("cloudflareZoneId"),
  domains: ["app.example.com"],
  r2Bucket: { bucketName: "app-site", create: true },

  // Reference IDP from infrastructure stack
  githubIdentityProviderId: infraStack.getOutput("githubIdpId"),

  paths: [
    { pattern: "/public/*", access: "public" },
    { pattern: "/app/*", access: "github-org", organizations: ["my-org"] },
  ],
});
```

## Implementation Plan

### Step 1: Update Type Definitions

1. **Update `PathConfig` interface**:
   - Add `organizations?: pulumi.Input<string>[]` field
   - Update JSDoc comments

2. **Update `WorkerSiteArgs` interface**:
   - Remove `githubOrganizations` field
   - Remove `githubOAuthConfig` field
   - Keep `githubIdentityProviderId` as optional
   - Update JSDoc comments

3. **Remove component property**:
   - Remove `githubIdp?: cloudflare.ZeroTrustAccessIdentityProvider` property

### Step 2: Update Validation Logic

1. **Add per-path validation**:
   - Check that paths with `github-org` access have `organizations` specified
   - Validate `organizations` array is not empty
   - Provide clear error messages with path pattern

2. **Update IDP validation**:
   - Only require `githubIdentityProviderId` when at least one path uses `github-org` access
   - Remove mutual exclusivity check for `githubOAuthConfig`

### Step 3: Update Policy Creation Logic

1. **Update policy creation**:
   - Use per-path `organizations` instead of top-level `githubOrganizations`
   - Remove IDP auto-creation logic
   - Simplify IDP ID handling (always from `githubIdentityProviderId`)

### Step 4: Update Documentation

1. **Update README**:
   - Add IDP creation examples
   - Document IDP sharing patterns
   - Show per-path organization control
   - Add stack reference examples

2. **Update examples**:
   - Create example showing standalone IDP creation
   - Create example showing IDP sharing
   - Create example showing stack references

### Migration & Rollout

- **No migration required**: Still in active development, no published version
- **Breaking changes**: Yes, but acceptable during development phase
- **Rollout**: Will be released as part of initial stable version

### Dependencies

- Cloudflare Pulumi provider with `ZeroTrustAccessIdentityProvider` support
- No new external dependencies required

## Related

- **Issue**: #51
- **Repository**: `@jmmaloney4/sector7`
- **Module**: `WorkerSite` component
- **Resources**:
  - [Pulumi Cloudflare ZeroTrustAccessIdentityProvider](https://www.pulumi.com/registry/packages/cloudflare/api-docs/zerotrustaccessidentityprovider/)
  - [Cloudflare Access Identity Providers](https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/)
  - [Cloudflare Access Policies](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  - [GitHub OAuth Apps Documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
  - [Pulumi Stack References](https://www.pulumi.com/docs/concepts/stack/#stackreferences)
- **Motivation**: Setup friction discovered during `theoretical-edge` blog deployment (jmmaloney4/garden)

---

Author: Claude Code
Date: 2025-11-04
Issue: #51 (transferred from jmmaloney4/jackpkgs#89)
PR: #TBD

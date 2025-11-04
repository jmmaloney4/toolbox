# WorkerSite

A Pulumi ComponentResource for hosting static sites on Cloudflare Workers with Zero Trust access control via Cloudflare Access.

## Features

- R2-backed Worker serving static files with Cache API
- Multiple domains via WorkerDomain
- Automatic DNS record creation
- Flexible path-level access control (any number of paths)
- Per-path GitHub organization requirements (granular access control)
- GitHub organization-based authentication via external IDP
- IDP sharing across multiple sites and stacks
- Edge caching with configurable TTL
- Automatic content-type detection
- ETag and observability headers (X-Cache-Status)

**Future Enhancements:**
- SPA fallback, custom 404 pages, range request support

## Prerequisites

1. **Cloudflare Account**: You need a Cloudflare account with:
   - A zone (domain) configured and using Cloudflare nameservers
   - Zero Trust enabled (only required for sites with `github-org` access paths)

2. **GitHub Identity Provider** (optional, only for sites with `github-org` access):
   - Create a `cloudflare.ZeroTrustAccessIdentityProvider` resource in your Pulumi stack
   - Requires a GitHub OAuth app (see [GitHub OAuth App Setup](#github-oauth-app-setup))
   - Can be shared across multiple WorkerSites and even across stacks
   - Not needed for public-only sites

## Usage

### Option 1: Public-Only Site (No Authentication)

For sites that don't require any authentication:

```typescript
import * as workersite from "@jmmaloney4/sector7/workersite";

const site = new workersite.WorkerSite("public-docs", {
  accountId: "your-cloudflare-account-id",
  zoneId: "your-cloudflare-zone-id",
  name: "public-docs",
  domains: ["docs.example.com"],

  r2Bucket: {
    bucketName: "public-docs-assets",
    create: true,
  },

  // All paths are public - no GitHub config needed!
  paths: [
    { pattern: "/*", access: "public" },
  ],

  cacheTtlSeconds: 86400, // 1 day
});
```

### Option 2: Site with GitHub Authentication (Standalone IDP)

For sites requiring GitHub org authentication, create the IDP separately:

**Prerequisites**: Manually create a GitHub OAuth app ([see instructions](#github-oauth-app-setup))

```typescript
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import * as workersite from "@jmmaloney4/sector7/workersite";

const config = new pulumi.Config();

// Create a standalone GitHub IDP (can be shared across multiple sites)
const githubIdp = new cloudflare.ZeroTrustAccessIdentityProvider("github-idp", {
  accountId: config.require("cloudflareAccountId"),
  name: "GitHub",
  type: "github",
  configs: [{
    clientId: config.requireSecret("githubClientId"),
    clientSecret: config.requireSecret("githubClientSecret"),
  }],
});

const site = new workersite.WorkerSite("internal-docs", {
  accountId: config.require("cloudflareAccountId"),
  zoneId: config.require("cloudflareZoneId"),
  name: "internal-docs",
  domains: ["internal.example.com"],

  r2Bucket: {
    bucketName: "internal-docs-assets",
    create: true,
  },

  // Reference the IDP
  githubIdentityProviderId: githubIdp.id,

  // Per-path organization control
  paths: [
    { pattern: "/public/*", access: "public" },
    { pattern: "/engineering/*", access: "github-org", organizations: ["my-org-eng"] },
    { pattern: "/shared/*", access: "github-org", organizations: ["my-org-eng", "my-org-leadership"] },
  ],
});

// Export the IDP ID for potential reuse in other stacks
export const githubIdpId = githubIdp.id;
```

### Option 3: Sharing IDP Across Multiple Sites

The same GitHub IDP can be shared across multiple WorkerSites:

```typescript
import * as cloudflare from "@pulumi/cloudflare";
import * as workersite from "@jmmaloney4/sector7/workersite";

// Create one IDP for all sites
const githubIdp = new cloudflare.ZeroTrustAccessIdentityProvider("github-idp", {
  accountId: accountId,
  name: "GitHub - Shared",
  type: "github",
  configs: [{ clientId: "...", clientSecret: "..." }],
});

// Site 1: Engineering org only
const engineeringSite = new workersite.WorkerSite("engineering-site", {
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
const marketingSite = new workersite.WorkerSite("marketing-site", {
  accountId: accountId,
  zoneId: zoneId,
  domains: ["marketing.example.com"],
  r2Bucket: { bucketName: "marketing-site", create: true },
  githubIdentityProviderId: githubIdp.id,  // Same IDP!
  paths: [
    { pattern: "/*", access: "github-org", organizations: ["my-org-marketing"] },
  ],
});
```

### Option 4: IDP from Another Stack (Stack References)

For large organizations, create the IDP in an infrastructure stack and reference it in application stacks:

**Infrastructure Stack** (`infra/index.ts`):
```typescript
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

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
import * as workersite from "@jmmaloney4/sector7/workersite";

// Reference infrastructure stack
const infraStack = new pulumi.StackReference("infra", {
  name: "organization/infra/production",
});

const site = new workersite.WorkerSite("app-site", {
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

## Architecture

The WorkerSite component automatically creates:

1. **R2 Bucket** (optional): Stores your static assets
2. **Worker Script**: Serves files from R2 with Cache API and proper headers
3. **Worker Domains**: Binds the Worker to each custom domain
4. **DNS Records**: Automatic AAAA records for each domain (100::)
5. **Access Applications**: One per path pattern
6. **Access Policies**: Public (everyone) or restricted (GitHub org members)

## Access Control Flow

1. User requests a URL (e.g., `https://docs.example.com/research/data.json`)
2. Cloudflare Access checks which Access Application matches the path
3. If restricted path, Access prompts for GitHub authentication
4. After successful auth, Access verifies GitHub org membership
5. If authorized, request reaches the Worker
6. Worker checks edge cache (Cache API)
   - Cache HIT: Return immediately (microseconds)
   - Cache MISS: Fetch from R2, cache asynchronously, return (milliseconds)

**Important**: The Worker itself does NOT implement authentication. All auth is handled by Cloudflare Access at the edge, before requests reach the Worker.

## Cache Behavior

Phase 2 adds edge caching via Cloudflare's Cache API:

- **First request** (cache MISS): Fetches from R2, returns with `X-Cache-Status: MISS`
- **Subsequent requests** (cache HIT): Served from edge, returns with `X-Cache-Status: HIT`
- **Cache TTL**: Configurable via `cacheTtlSeconds` (default: 1 year)
- **Cache invalidation**: Automatic via ETag; purge manually if needed

Cache API **requires custom domains** (WorkerDomain) - won't work with `*.workers.dev`.

## Uploading Assets

After deploying the WorkerSite, upload your static files to R2:

```bash
# Using wrangler CLI
wrangler r2 object put docs-site-assets/index.html --file dist/index.html
wrangler r2 object put docs-site-assets/blog/post.html --file dist/blog/post.html

# Or use the R2 dashboard
# Or integrate with your CI/CD pipeline
```

**Directory Index**: The Worker automatically appends `index.html` to directory paths:
- `https://docs.example.com/` → fetches `index.html`
- `https://docs.example.com/blog/` → fetches `blog/index.html`

## Path Patterns

Access Applications support wildcards in paths:
- `/blog/*` - matches `/blog/post.html`, `/blog/2024/article.html`, etc.
- `/research/*` - matches `/research/data.json`, `/research/docs/paper.pdf`, etc.
- `/*` - matches all paths (global access control)

You can configure as many paths as needed. Each path gets its own Access Application and Policy.

**Note on precedence**: The order of paths in the `paths` array is important. It determines the precedence of the Cloudflare Access policies, with paths appearing earlier in the array having higher precedence (a lower precedence number). You should generally order your paths from most specific to least specific.

## DNS Management

Phase 2 automatically creates DNS records for all domains:

- **Type**: AAAA record
- **Value**: `100::` (Cloudflare Workers placeholder IPv6)
- **Proxied**: Yes (enables Cloudflare proxy)

**Requirements**:
- Domain must already be a zone in your Cloudflare account
- Zone must use Cloudflare nameservers
- DNS propagation may take a few minutes

## GitHub OAuth App Setup

If using Option 2 (auto-create IDP via `githubOAuthConfig`), you must first manually create a GitHub OAuth application.

### Steps:

1. **Get your Cloudflare Access team name**:
   - Go to Cloudflare Dashboard → Zero Trust → Settings
   - Note your team name (e.g., `mycompany`)
   - Your callback URL will be: `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`

2. **Create GitHub OAuth App**:
   - For organization apps: `https://github.com/organizations/<org-name>/settings/applications`
   - For personal apps: `https://github.com/settings/developers`
   - Click "New OAuth App"
   - **Application name**: `Cloudflare Access - <your-site>`
   - **Homepage URL**: Your site's URL
   - **Authorization callback URL**: `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`
   - Click "Register application"

3. **Get credentials**:
   - Note the **Client ID** (shown immediately)
   - Generate a **Client Secret** (copy immediately, won't be shown again)

4. **Store credentials securely**:
   ```bash
   pulumi config set --secret githubClientId <client-id>
   pulumi config set --secret githubClientSecret <client-secret>
   ```

For detailed instructions, see [ADR-006](../../docs/internal/designs/006-sector7-optional-github-auth.md).

## Configuration Reference

### WorkerSiteArgs

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountId` | `string` | Yes | Cloudflare account ID |
| `zoneId` | `string` | Yes | Cloudflare zone ID |
| `name` | `string` | Yes | Name for Worker and resources |
| `domains` | `string[]` | Yes | Domains to bind (e.g., `["docs.example.com", "www.docs.example.com"]`) |
| `manageDns` | `boolean` | No | Automatically create DNS records for domains (default: true) |
| `r2Bucket.bucketName` | `string` | Yes | R2 bucket name |
| `r2Bucket.create` | `boolean` | No | Create bucket if not exists (default: false) |
| `r2Bucket.prefix` | `string` | No | Optional object key prefix |
| `githubIdentityProviderId` | `string` | Conditional* | GitHub IDP ID (create separately using `cloudflare.ZeroTrustAccessIdentityProvider`) |
| `paths` | `PathConfig[]` | Yes | Path access configurations (see below) |
| `cacheTtlSeconds` | `number` | No | Cache TTL in seconds (default: 31536000 = 1 year) |

\* **Conditional**: Only required when at least one path has `access: "github-org"`.

### PathConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | `string` | Yes | Path pattern (e.g., `/blog/*`, `/research/*`) |
| `access` | `"public" \| "github-org"` | Yes | Access level: public (everyone) or github-org (org members) |
| `organizations` | `string[]` | Conditional* | GitHub organization names (e.g., `["my-org-eng", "my-org-leadership"]`) |

\* **Conditional**: Required when `access` is `"github-org"`. Members of ANY of these organizations will be granted access (OR logic).

## Troubleshooting

**Assets return 404:**
- Verify files are uploaded to R2 bucket
- Check object key paths match URL paths
- Remember directory index: `/blog/` needs `blog/index.html` in R2
- Check `X-Cache-Status` header to see if cache HIT or MISS

**Access not prompting for login:**
- Verify GitHub IdP is configured in Cloudflare Access
- Check Access Application domain matches your domain
- Ensure path patterns are correct
- Try incognito/private mode to test fresh session

**Cache not working:**
- Verify you're using a custom domain (not `*.workers.dev`)
- Check `X-Cache-Status` header in response
- First request will always be MISS
- Cache API requires WorkerDomain (automatic in Phase 2)

**DNS not resolving:**
- Verify domain is a zone in Cloudflare
- Check nameservers point to Cloudflare
- Wait a few minutes for DNS propagation
- Verify AAAA record exists with value `100::`

**Worker errors:**
- Check Worker logs in Cloudflare dashboard
- Verify R2 bucket binding is correct
- Ensure bucket exists and has correct name
- Check `CACHE_TTL_SECONDS` environment variable

## Performance Tips

1. **Cache TTL**: Set appropriate TTL for your use case
   - Static assets (images, fonts): 1 year (default)
   - Frequently updated content: 1 hour to 1 day
   - Dynamic-ish content: 5-15 minutes

2. **Content Hashing**: Use hashed filenames for cache busting
   - `app.abc123.js` instead of `app.js`
   - Allows long cache TTLs with instant updates

3. **R2 Costs**: Edge cache dramatically reduces R2 requests
   - First request: R2 fetch ($0.36/million Class A ops)
   - Subsequent requests: Edge cache (free)

4. **Monitor Cache Hit Rate**:
   - Check `X-Cache-Status` headers
   - High HIT rate = good performance + low costs
   - Low HIT rate = may need longer TTL

## Migration from Phase 1

Phase 2 has **breaking changes** from Phase 1:

```typescript
// Phase 1 (old)
{
  domain: "example.com",           // Single domain (string)
  publicPath: "/blog/*",            // Hardcoded 2 paths
  restrictedPath: "/research/*",
}

// Phase 2 (new)
{
  domains: ["example.com"],         // Multiple domains (array)
  paths: [                          // Flexible paths (array)
    { pattern: "/blog/*", access: "public" },
    { pattern: "/research/*", access: "github-org" },
  ],
}
```

**Migration steps:**
1. Update `domain` → `domains` (wrap in array)
2. Combine `publicPath` + `restrictedPath` → `paths` array
3. Optional: Add `cacheTtlSeconds` for custom cache TTL
4. Optional: Add more domains or paths

## Related Documentation

- [ADR-005: Cloudflare WorkerSite Design](../../../docs/internal/designs/005-cloudflare-workersite.md)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare Access Documentation](https://developers.cloudflare.com/cloudflare-one/policies/access/)
- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)

## License

MPL-2.0

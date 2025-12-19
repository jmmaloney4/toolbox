# WorkerSite

A Pulumi ComponentResource for hosting static sites on Cloudflare Workers with Zero Trust access control via Cloudflare Access.

## Features

**Phase 2 (Current):**
- R2-backed Worker serving static files with Cache API
- Multiple domains via WorkerDomain
- Automatic DNS record creation
- Flexible path-level access control (any number of paths)
- GitHub organization-based authentication
- Edge caching with configurable TTL
- Automatic content-type detection
- ETag and observability headers (X-Cache-Status)

**Future Phases:**
- Phase 3: SPA fallback, custom 404 pages, range request support

## Prerequisites

1. **Cloudflare Account**: You need a Cloudflare account with:
   - A zone (domain) configured and using Cloudflare nameservers
   - Zero Trust enabled
   - GitHub Identity Provider configured in Cloudflare Access

2. **GitHub Identity Provider**: Create this in Cloudflare Access first:
   - Go to Zero Trust → Settings → Authentication
   - Add GitHub as a login method
   - Note the Identity Provider ID (you'll need this)

## Usage

```typescript
import * as workersite from "@jmmaloney4/sector7/workersite";

const site = new workersite.WorkerSite("docs-site", {
  accountId: "your-cloudflare-account-id",
  zoneId: "your-cloudflare-zone-id",
  name: "docs-site",

  // Multiple domains supported
  domains: ["docs.example.com", "www.docs.example.com"],

  r2Bucket: {
    bucketName: "docs-site-assets",
    create: true,  // Create the bucket if it doesn't exist
  },

  githubIdentityProviderId: "your-github-idp-id",
  githubOrganizations: ["your-org"],

  // Flexible paths - any number supported
  paths: [
    { pattern: "/blog/*", access: "public" },
    { pattern: "/docs/*", access: "public" },
    { pattern: "/research/*", access: "github-org" },
    { pattern: "/admin/*", access: "github-org" },
  ],

  // Optional: Configure cache TTL (default: 1 year)
  cacheTtlSeconds: 86400, // 1 day
});

// Export useful outputs
export const workerName = site.workerName;
export const boundDomains = site.boundDomains;
```

## Architecture

The WorkerSite component automatically creates:

1. **R2 Bucket** (optional): Stores your static assets
2. **Worker Script**: Serves files from R2 with Cache API and proper headers
3. **Worker Domains**: Binds the Worker to each custom domain (requires `environment` property in Pulumi Cloudflare v6+)
4. **DNS Records**: Automatic AAAA records for each domain (100::)
5. **Access Applications**: One per (domain, path) combination with embedded policies
   - Each application contains its own policy configuration
   - Policies define access rules: public (everyone) or restricted (GitHub org members)

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

You can configure as many paths as needed. Each (domain, path) combination gets its own Access Application with an embedded policy.

**Note on policy architecture** (Pulumi Cloudflare v6+): Policies are now embedded within Access Applications rather than created as separate resources. Each application has its own policy with `precedence: 1` (the only policy for that application). This change doesn't affect functionality - access control works the same way, but the resource model is simplified.

## DNS Management

Phase 2 automatically creates DNS records for all domains:

- **Type**: AAAA record
- **Value**: `100::` (Cloudflare Workers placeholder IPv6)
- **Proxied**: Yes (enables Cloudflare proxy)

**Requirements**:
- Domain must already be a zone in your Cloudflare account
- Zone must use Cloudflare nameservers
- DNS propagation may take a few minutes

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
| `githubIdentityProviderId` | `string` | Yes | GitHub IdP ID from Cloudflare Access |
| `githubOrganizations` | `string[]` | Yes | GitHub org names for restricted access |
| `paths` | `PathConfig[]` | Yes | Path access configurations (see below) |
| `cacheTtlSeconds` | `number` | No | Cache TTL in seconds (default: 31536000 = 1 year) |

### PathConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | `string` | Yes | Path pattern (e.g., `/blog/*`) |
| `access` | `"public" \| "github-org"` | Yes | Access level: public (everyone) or github-org (org members) |

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

# Cloudflare Components

Reusable Pulumi components for Cloudflare infrastructure.

## WorkerSite

A Pulumi ComponentResource for hosting static sites on Cloudflare Workers with Zero Trust access control via Cloudflare Access.

### Features

**Phase 1 MVP (Current):**
- R2-backed Worker serving static files
- Single domain via WorkerRoute
- Path-level access control with Cloudflare Access
- GitHub organization-based authentication
- Automatic content-type detection
- ETag and cache headers

**Future Phases:**
- Phase 2: Cache API, multiple domains, DNS management, KV backend
- Phase 3: SPA fallback, custom cache TTL, observability headers

### Prerequisites

1. **Cloudflare Account**: You need a Cloudflare account with:
   - A zone (domain) configured
   - Zero Trust enabled
   - GitHub Identity Provider configured in Cloudflare Access

2. **GitHub Identity Provider**: Create this in Cloudflare Access first:
   - Go to Zero Trust → Settings → Authentication
   - Add GitHub as a login method
   - Note the Identity Provider ID (you'll need this)

### Usage

```typescript
import * as workersite from "@jmmaloney4/sector7/workersite";

const site = new workersite.WorkerSite("docs-site", {
  accountId: "your-cloudflare-account-id",
  zoneId: "your-cloudflare-zone-id",
  name: "docs-site",
  domain: "docs.example.com",

  r2Bucket: {
    bucketName: "docs-site-assets",
    create: true,  // Create the bucket if it doesn't exist
  },

  githubIdentityProviderId: "your-github-idp-id",
  githubOrganizations: ["your-org"],

  publicPath: "/blog/*",       // Public access
  restrictedPath: "/research/*", // Requires GitHub org membership
});

// Export useful outputs
export const workerName = site.workerName;
export const boundDomain = site.boundDomain;
```

### Architecture

The WorkerSite component creates:

1. **R2 Bucket** (optional): Stores your static assets
2. **Worker Script**: Serves files from R2 with proper headers
3. **Worker Route**: Binds the Worker to your domain pattern
4. **Access Applications** (2): One for public path, one for restricted path
5. **Access Policies** (2):
   - Public policy allows everyone
   - Restricted policy allows only GitHub org members

### Access Control Flow

1. User requests a URL (e.g., `https://docs.example.com/research/data.json`)
2. Cloudflare Access checks which Access Application matches the path
3. If restricted path, Access prompts for GitHub authentication
4. After successful auth, Access verifies GitHub org membership
5. If authorized, request reaches the Worker
6. Worker fetches file from R2 and returns it with proper headers

**Important**: The Worker itself does NOT implement authentication. All auth is handled by Cloudflare Access at the edge, before requests reach the Worker.

### Uploading Assets

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

### Path Patterns

Access Applications support wildcards in paths:
- `/blog/*` - matches `/blog/post.html`, `/blog/2024/article.html`, etc.
- `/research/*` - matches `/research/data.json`, `/research/docs/paper.pdf`, etc.

**Note**: Phase 1 MVP supports exactly 2 paths (one public, one restricted). Phase 2 will support arbitrary numbers of paths with flexible access policies.

### Limitations (Phase 1 MVP)

- **Single domain**: Only one domain supported (Phase 2 will add multi-domain)
- **No caching**: Cache API requires custom domains (Phase 2 will add caching)
- **Two paths only**: Hardcoded to one public + one restricted path
- **WorkerRoute only**: Uses WorkerRoute, not Worker Custom Domains yet
- **No DNS management**: You must configure DNS separately
- **No SPA fallback**: 404s return 404 (Phase 3 will add SPA mode)

### Configuration Reference

#### WorkerSiteArgs

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountId` | `string` | Yes | Cloudflare account ID |
| `zoneId` | `string` | Yes | Cloudflare zone ID |
| `name` | `string` | Yes | Name for Worker and resources |
| `domain` | `string` | Yes | Domain to bind (e.g., `docs.example.com`) |
| `r2Bucket.bucketName` | `string` | Yes | R2 bucket name |
| `r2Bucket.create` | `boolean` | No | Create bucket if not exists (default: false) |
| `r2Bucket.prefix` | `string` | No | Optional object key prefix |
| `githubIdentityProviderId` | `string` | Yes | GitHub IdP ID from Cloudflare Access |
| `githubOrganizations` | `string[]` | Yes | GitHub org names for restricted access |
| `publicPath` | `string` | Yes | Public path pattern (e.g., `/blog/*`) |
| `restrictedPath` | `string` | Yes | Restricted path pattern (e.g., `/research/*`) |

### Troubleshooting

**Assets return 404:**
- Verify files are uploaded to R2 bucket
- Check object key paths match URL paths
- Remember directory index: `/blog/` needs `blog/index.html` in R2

**Access not prompting for login:**
- Verify GitHub IdP is configured in Cloudflare Access
- Check Access Application domain matches your domain
- Ensure path patterns are correct

**Worker errors:**
- Check Worker logs in Cloudflare dashboard
- Verify R2 bucket binding is correct
- Ensure bucket exists and has correct name

### Related Documentation

- [ADR-005: Cloudflare WorkerSite Design](../../../docs/internal/designs/005-cloudflare-workersite.md)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare Access Documentation](https://developers.cloudflare.com/cloudflare-one/policies/access/)

### License

MPL-2.0

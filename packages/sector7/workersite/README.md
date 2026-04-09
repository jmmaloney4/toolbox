# WorkerSite

`WorkerSite` is a Pulumi `ComponentResource` for hosting static sites on Cloudflare Workers with R2 storage, optional Cloudflare Access protection, declarative asset uploads, and custom-domain bindings.

## Features

- R2-backed Worker serving static files with Cache API support
- Multiple domains via `WorkersCustomDomain`
- DNS managed automatically by Cloudflare custom-domain bindings
- Optional path-level Cloudflare Access policies
- Optional declarative R2 uploads during `pulumi up`
- Optional host redirects in the generated Worker script
- Optional custom Worker script with extra plain-text bindings
- Default Cloudflare Worker observability with configurable request/log sampling

## Prerequisites

1. Cloudflare account with a zone already managed by Cloudflare nameservers
2. Zone ID and account ID for the target site
3. If you use `github-org` access, a GitHub Identity Provider configured in Cloudflare Access
4. If you use `assets`, `@aws-sdk/client-s3` available to the Pulumi program

## Usage

### Public site with declarative uploads and redirect

```typescript
import { WorkerSite } from "@jmmaloney4/sector7/workersite";

const site = new WorkerSite("docs-site", {
  accountId: "your-cloudflare-account-id",
  zoneId: "your-cloudflare-zone-id",
  name: "docs-site",
  domains: ["docs.example.com", "www.docs.example.com"],
  r2Bucket: {
    bucketName: "docs-site-assets",
    create: true,
  },
  redirects: [
    {
      fromHost: "www.docs.example.com",
      toHost: "docs.example.com",
      statusCode: 301,
    },
  ],
  assets: {
    files: [
      {
        key: "index.html",
        filePath: "/absolute/path/to/dist/index.html",
        contentType: "text/html; charset=utf-8",
      },
      {
        key: "styles.css",
        filePath: "/absolute/path/to/dist/styles.css",
        contentType: "text/css; charset=utf-8",
      },
    ],
  },
});

export const workerName = site.workerName;
export const boundDomains = site.boundDomains;
```

### Mixed public/private site with Cloudflare Access

```typescript
import { WorkerSite } from "@jmmaloney4/sector7/workersite";

const site = new WorkerSite("research-site", {
  accountId: "your-cloudflare-account-id",
  zoneId: "your-cloudflare-zone-id",
  name: "research-site",
  domains: ["research.example.com"],
  r2Bucket: {
    bucketName: "research-site-assets",
    create: true,
  },
  githubIdentityProviderId: "your-github-idp-id",
  githubOrganizations: ["your-org"],
  paths: [
    { pattern: "/public/*", access: "public" },
    { pattern: "/private/*", access: "github-org" },
  ],
});
```

### Custom Worker script

```typescript
import { WorkerSite } from "@jmmaloney4/sector7/workersite";

const site = new WorkerSite("custom-site", {
  accountId: "your-cloudflare-account-id",
  zoneId: "your-cloudflare-zone-id",
  name: "custom-site",
  domains: ["example.com", "www.example.com"],
  r2Bucket: {
    bucketName: "custom-site-assets",
  },
  workerScript: {
    content: builtWorkerSource,
    extraBindings: [
      { name: "APEX_DOMAIN", text: "example.com" },
      { name: "WWW_DOMAIN", text: "www.example.com" },
    ],
  },
});
```

When `workerScript` is provided, the generated script is skipped and `redirects` are ignored. `R2_BUCKET` and `CACHE_TTL_SECONDS` bindings are still injected automatically.

## Observability

`WorkerSite` enables Cloudflare Worker observability by default on the managed `cloudflare.WorkersScript`:

- request observability enabled
- request sampling defaulted to `0.1`
- Worker logs enabled
- invocation logs enabled
- Cloudflare log destination enabled
- log persistence enabled

You can override those defaults with `observability`:

```typescript
import * as pulumi from "@pulumi/pulumi";
import {
  WorkerSite,
  type WorkerObservabilityConfig,
} from "@jmmaloney4/sector7/workersite";

const config = new pulumi.Config();
const workerObservability =
  config.getObject<WorkerObservabilityConfig>("workerObservability") ?? undefined;

const site = new WorkerSite("docs-site", {
  accountId: "your-cloudflare-account-id",
  zoneId: "your-cloudflare-zone-id",
  name: "docs-site",
  domains: ["docs.example.com"],
  r2Bucket: {
    bucketName: "docs-site-assets",
  },
  observability: workerObservability,
});
```

Recommended stack config values:

```yaml
config:
  your-project:workerObservability:
    # Production baseline: 10% request and log sampling
    headSamplingRate: 0.1
    logs:
      headSamplingRate: 0.1
```

- Defaults you can omit: `enabled: true`, `logs.enabled: true`, `logs.invocationLogs: true`, `logs.destinations: ["cloudflare"]`, `logs.persist: true`
- Normal production baseline: keep sampling at `0.1`
- Incident response / active debugging: temporarily raise both sampling rates to `1.0`

After adding this config, `pulumi preview` should show an `observability` block on the `cloudflare:WorkersScript` resource.

## What the component creates

`WorkerSite` creates:

1. An optional `cloudflare.R2Bucket` when `r2Bucket.create` is `true`
2. A `cloudflare.WorkersScript`
3. One `cloudflare.WorkersCustomDomain` per hostname in `domains`
4. Zero or more `cloudflare.ZeroTrustAccessApplication` resources, one per `(domain, path)` combination when `paths` is provided
5. An `cloudflare.AccountToken` plus one `R2Object` per uploaded file when `assets` is provided

## Access control model

- Omit `paths` for a fully public site
- Use `paths` with `access: "public"` or `access: "github-org"` to create Cloudflare Access applications
- `githubIdentityProviderId` and `githubOrganizations` are required only when at least one path uses `github-org`

Cloudflare Access enforces authorization before requests reach the Worker. The Worker itself does not implement authentication.

## Asset uploads

If you pass `assets`, `WorkerSite` uploads files declaratively as part of `pulumi up`.

- Each file becomes a separate `R2Object` dynamic resource
- Change detection uses MD5/ETag comparison
- The component creates a scoped `AccountToken` for R2 object writes automatically
- The token scope is limited to the configured bucket

If you do not pass `assets`, you can still upload files by another workflow and let `WorkerSite` only manage the Worker and domains.

## Redirects

`redirects` injects host-based redirect logic into the generated Worker script before any cache lookup or R2 fetch. A common use case is `www -> apex`.

```typescript
redirects: [
  {
    fromHost: "www.example.com",
    toHost: "example.com",
    statusCode: 301,
  },
]
```

## DNS behavior

`WorkerSite` now uses `WorkersCustomDomain` and does not create explicit `cloudflare.Record` resources.

- `zoneId` is required
- Cloudflare manages the DNS record associated with each custom-domain binding
- This avoids the redundant-record `409 Conflict` problem tracked in issue `#113`

## Configuration reference

### `WorkerSiteArgs`

| Field                      | Type                 | Required    | Description                                          |
| -------------------------- | -------------------- | ----------- | ---------------------------------------------------- |
| `accountId`                | `string`             | Yes         | Cloudflare account ID                                |
| `zoneId`                   | `string`             | Yes         | Cloudflare zone ID required by `WorkersCustomDomain` |
| `name`                     | `string`             | Yes         | Name for the Worker and related resources            |
| `domains`                  | `string[]`           | Yes         | Hostnames to bind to the Worker                      |
| `r2Bucket.bucketName`      | `string`             | Yes         | R2 bucket name                                       |
| `r2Bucket.create`          | `boolean`            | No          | Create the bucket if it does not already exist       |
| `r2Bucket.prefix`          | `string`             | No          | Prefix prepended to generated-script object lookups  |
| `githubIdentityProviderId` | `string`             | Conditional | Required when a path uses `github-org`               |
| `githubOrganizations`      | `string[]`           | Conditional | Required when a path uses `github-org`               |
| `paths`                    | `PathConfig[]`       | No          | Access-control rules; omit for fully public sites    |
| `cacheTtlSeconds`          | `number`             | No          | Cache TTL for generated Worker responses             |
| `assets`                   | `AssetConfig`        | No          | Declarative upload configuration                     |
| `redirects`                | `RedirectRule[]`     | No          | Host redirects for the generated Worker              |
| `workerScript`             | `WorkerScriptConfig` | No          | Custom Worker source and extra bindings              |
| `observability`            | `WorkerObservabilityConfig` | No   | Worker observability and log sampling settings       |

### `PathConfig`

| Field     | Type                       | Required | Description                    |
| --------- | -------------------------- | -------- | ------------------------------ |
| `pattern` | `string`                   | Yes      | Path pattern such as `/blog/*` |
| `access`  | `"public" \| "github-org"` | Yes      | Access mode for the path       |

### `AssetConfig`

| Field   | Type          | Required | Description                            |
| ------- | ------------- | -------- | -------------------------------------- |
| `files` | `AssetFile[]` | Yes      | Files uploaded to R2 during deployment |

### `WorkerScriptConfig`

| Field           | Type               | Required | Description                      |
| --------------- | ------------------ | -------- | -------------------------------- |
| `content`       | `Input<string>`    | Yes      | Pre-built Worker source          |
| `extraBindings` | `{ name, text }[]` | No       | Additional `plain_text` bindings |

### `WorkerObservabilityConfig`

| Field                           | Type        | Required | Description                                          |
| ------------------------------- | ----------- | -------- | ---------------------------------------------------- |
| `enabled`                       | `boolean`   | No       | Enables Worker observability                         |
| `headSamplingRate`              | `number`    | No       | Request sampling rate; defaults to `0.1`             |
| `logs.enabled`                  | `boolean`   | No       | Enables Worker logs                                  |
| `logs.headSamplingRate`         | `number`    | No       | Log sampling rate; defaults to `headSamplingRate`    |
| `logs.invocationLogs`           | `boolean`   | No       | Enables invocation logs                              |
| `logs.destinations`             | `string[]`  | No       | Log destinations; defaults to `["cloudflare"]`       |
| `logs.persist`                  | `boolean`   | No       | Persists logs in Cloudflare                          |

## Troubleshooting

### Assets return 404

- Verify the uploaded key matches the URL path the Worker will request
- Remember directory index handling: `/docs/` maps to `docs/index.html`
- If using `r2Bucket.prefix`, verify the generated Worker should be looking under that prefix

### Access does not prompt for login

- Verify the GitHub Identity Provider exists in Cloudflare Access
- Ensure at least one configured `paths` entry uses `github-org`
- Confirm the requested URL matches the configured hostname and path pattern

### Cache behavior looks wrong

- Cache behavior only applies on custom domains, not `*.workers.dev`
- Check the `X-Cache-Status` response header from the generated Worker
- The first request after deploy is normally a MISS

### Cloudflare Error 1101: Worker threw exception

1. Temporarily raise `observability.headSamplingRate` and `observability.logs.headSamplingRate` to `1.0`
2. Run `pulumi preview` or `pulumi up` and confirm the `WorkersScript` `observability` settings changed as expected
3. Reproduce the failing request and inspect Worker invocation logs in Cloudflare
4. Fix the exception, redeploy, and then return sampling to the normal `0.1` production baseline

### Domain binding fails

- Verify `zoneId` matches the zone that owns the hostname
- Ensure the zone is actually managed by Cloudflare
- Do not create a duplicate explicit DNS record for the same custom domain

## Related documentation

- `docs/internal/designs/005-cloudflare-workersite.md`
- `docs/internal/designs/011-workersite-extensions.md`
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare custom domains: https://developers.cloudflare.com/workers/platform/triggers/custom-domains/

## License

MPL-2.0

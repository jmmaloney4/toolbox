---
id: ADR-001
title: Reusable Quarto Multi‑Site Deploy to Cloudflare Pages with Pulumi Component
status: Proposed
date: 2025-09-10
deciders: [platform]
consulted: [docs, data, infra]
tags: [docs, ci, cloudflare, pulumi, quarto]
supersedes: []
superseded_by: []
links:
  - guide: ../quarto.md
---

# Context
- We want to deploy multiple Quarto sites from a single repository to Cloudflare Pages.
- CI must be reusable across repositories; infra should be automated and idempotent via Pulumi.
- GitHub `workflow_call` inputs accept only primitive types; there is no typed array/object input.
- Defaults agreed:
  - Production branch: `main`.
  - Domains: subdomains only (no apex)
  - Zones are on Cloudflare nameservers.
  - One Cloudflare Pages project per site.

# Decision
1) Provide a reusable GitHub Actions workflow that:
   - Accepts `runs-on`, `repository`, `ref`, `cloudflare-account-id` (strings) and `sites` (JSON string array).
   - Uses `fromJSON(inputs.sites)` to construct a matrix and build/deploy each site in parallel.
   - Uses Nix to run Quarto build; validates `${dist}/index.html`; deploys via Cloudflare Pages "Direct Uploads".
2) Ship a Pulumi ComponentResource (`PagesSite`) that:
   - Creates a `cloudflare.PagesProject` for each site.
   - Binds a custom subdomain via `cloudflare.PagesDomain`.
   - Optionally ensures the Zone and an explicit DNS record when needed (typically unnecessary if the zone is on Cloudflare).
3) Manage custom domains via Cloudflare (UI/API/IaC), not the deploy action itself.

# Consequences
## Positive
- Scales to N sites with a single workflow; parallel builds reduce total time.
- Infra is declarative and reusable; domains are consistently managed.
- Clear separation of concerns between CI (build/deploy) and IaC (provisioning).

## Negative
- Callers must pass structured site configs as a JSON string (typed YAML objects are not supported for `workflow_call`).
- Multiple Pages projects increase the number of resources to manage.

# Alternatives
- One workflow per site: simpler, but duplicates logic and scales poorly.
- Composite action combining infra + CI: couples provisioning to CI, harder to keep idempotent and auditable.
- GitHub Pages + Cloudflare proxy: changes hosting model; out-of-scope.

# Security / Privacy / Compliance
- Use least-privilege Cloudflare API tokens:
  - Required: Account → Cloudflare Pages: Edit.
  - Optional (for automated domains/DNS): Zone → DNS: Edit, Zone → Zone: Read.
- Store tokens as repository or org secrets. Avoid echoing tokens in logs.
- Consider branch protection and environment protections for production deploys.

# Operational Notes
- Cost: Cloudflare Pages free tier may suffice; monitor plan limits.
- Observability: rely on GitHub job logs and Cloudflare Pages deployment logs; capture deployment URLs as outputs.
- Rollout: matrix concurrency per site; safe to re-run failed sites.
- Backout: redeploy previous ref; remove domain bindings via Pulumi if needed.

# Status Transitions
- New ADR; no supersessions.

# Implementation Notes
- Reusable workflow uses: `actions/checkout@v4`, Determinate Systems Nix actions, and `andykenward/github-actions-cloudflare-pages@v3` for direct uploads.
- The workflow expects the caller to pass `sites` JSON entries with fields: `name`, `path`, `dist`, `cloudflare_project_name`, `env_prod`, `env_preview`.
- `docs/quarto.md` provides the end-to-end setup steps for Cloudflare and workflow usage.

# References
- Cloudflare Pulumi provider: `PagesProject`, `PagesDomain`.
- GitHub Actions `workflow_call` and `fromJSON` usage for dynamic matrices.

---

## Appendix A — Implementation Plan

### Scope
- CI: Convert `.github/workflows/quarto.yml` to a reusable workflow with JSON matrix input.
- IaC: Create a Pulumi ComponentResource to provision Cloudflare Pages projects and bind custom subdomains.
- Docs: Author `docs/quarto.md` with step-by-step setup; maintain ADRs under `docs/internal/designs/`.

### Milestones
- M1: Pulumi component scaffold + example usage (day 1–2)
- M2: Reusable workflow authored and smoke-tested on one site (day 2–3)
- M3: Documentation complete and reviewed (day 3–4)
- M4: Multi-site validation (two sites) (day 4–5)

### Tasks
1) Pulumi ComponentResource (`PagesSite`)
   - Define inputs: `accountId`, `zone`, `projectName`, `domain`, optional `productionBranch`, `manageZone`, `createDnsRecord`.
   - Create resources: `PagesProject`, `PagesDomain`, optional `Zone` and `Record`.
   - Export outputs: `subdomain`, `domain`, `projectName`.
   - Add README with token scopes, examples.
2) Reusable Workflow
   - Inputs: `runs-on`, `repository`, `ref`, `cloudflare-account-id`, `sites` (JSON), secrets: `cloudflare_api_token`, `github_token`.
   - Steps: checkout caller repo/ref; Nix setup; `quarto render` per site; validate dist; deploy via direct uploads; set environments per branch.
   - Concurrency per site + ref; `fail-fast: false`.
   - Example caller workflow(s) for single-site and multi-site.
3) Documentation
   - `docs/quarto.md` with Cloudflare account setup, token scopes, account ID lookup, Pulumi provisioning (including component usage), and workflow consumption examples.
   - Troubleshooting and FAQ (structured inputs vs JSON).

### Risks & Mitigations
- Provider/API drift: pin Pulumi provider versions; test in a staging account.
- Token scope issues: document minimal scopes and verification steps.
- Large sites build time: leverage matrix parallelism; cache via Nix where possible.

### Test Plan
- Unit: Pulumi preview validates resource graph and diffs.
- Integration: create a temporary Pages project and deploy via the reusable workflow; confirm domain binding.
- E2E: two-site matrix deploy, verify production and preview environments produce URLs.

### Rollout
- Start with one site; then add a second site to the `sites` matrix.
- Enable environment protections for production environments if needed.

### Backout
- Re-run with previous commit SHA to redeploy.
- Destroy domains/projects via Pulumi `destroy` if decommissioning a site.

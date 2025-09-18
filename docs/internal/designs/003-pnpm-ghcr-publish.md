# ADR-003: pnpm Package Publishing to GHCR

**Status:** Accepted  
**Date:** 2024-12-19  
**Context:** Provide a reusable workflow to publish pnpm packages in `packages/*` to GitHub's npm registry (GHCR), with a dry‑run analysis mode that reports what would be published and why.

## Decision

Create a reusable GitHub Actions workflow (`.github/workflows/pnpm-publish.yml`) that:
- Is invoked via `workflow_call` (no direct triggers); callers decide when to run (e.g., on tag push).
- Accepts inputs: `runs-on`, `repository`, `ref`, and `dry_run` (default `false`).
- Uses a composite action (`.github/actions/analyze-pnpm-packages`) to:
  - detect packages in `packages/*`,
  - query GHCR/npm for current published versions,
  - compute semantic version deltas vs. local `package.json`,
  - emit a JSON matrix and a human‑readable summary (always printed),
  - mark actions per package (`publish`/`skip`).
- Publishes only when `dry_run` is `false` and the package action is `publish`.

## Rationale

- **Reusability:** Clean `workflow_call` interface lets any repo adopt the same flow.
- **Clarity:** Always-on summary (with DRY RUN banner when applicable) improves visibility and auditability.
- **Separation of concerns:** Composite action encapsulates shell logic (curl/jq/semver) for maintainability.
- **Monorepo fit:** Matrix per package; independent decisions and outcomes.
- **Consistency:** Uses Nix dev env and existing Node/pnpm setup patterns.

## Implementation Details

### Reusable Interface
- `on.workflow_call.inputs`:
  - `runs-on` (string, required): runner label.
  - `repository` (string, required): owner/repo to checkout.
  - `ref` (string, required): git ref to checkout.
  - `dry_run` (boolean, default `false`): analyze only; print summary; skip publish.
- Consumers own triggers (e.g., `on: push: tags: ['v*']`) and pass inputs accordingly.
- Always operate on the caller's repo/ref using `actions/checkout` with provided inputs.

### Analysis Composite Action
- Path: `.github/actions/analyze-pnpm-packages/`
- Invocation (from reusable workflow):
  - Use repository path with pinned ref, not local path (for cross-repo reuse).
  - Example: `uses: jmmaloney4/toolbox/.github/actions/analyze-pnpm-packages@<ref>`
- Inputs: `dry_run`, `registry` (default `https://npm.pkg.github.com`), `root` (default `.`), optional `scope`.
- Env: `NODE_AUTH_TOKEN` required for private package metadata; workflow sets `packages: read`.
- Responsibilities:
  - Detect packages under `packages/*/package.json` (optionally filter by `scope`).
  - Query GHCR npm registry for each `name` to get `dist-tags.latest` (published version).
  - Compare local vs. published versions; classify change: `same`, `patch`, `minor`, `major`, `initial`, `downgrade`.
  - Emit:
    - `matrix` (JSON array with `package_path`, `name`, `local_version`, `published_version`, `release_type`, `action`).
    - Summary to `$GITHUB_STEP_SUMMARY`: always printed; DRY RUN banner when `dry_run` is true.
- Implementation Notes:
  - Use `curl` with `Authorization: Bearer $NODE_AUTH_TOKEN` and `Accept: application/vnd.npm.install-v1+json` against `${registry}/@scope%2Fname`.
  - Use `bash` + `node -e` for minimal JSON handling; optionally `jq` if present.
  - Basic semver compare via numeric major/minor/patch; prerelease is surfaced in notes but not used for classification in MVP.

### Workflow Structure
- Jobs:
  1) `analyze` (permissions: `contents: read`, `packages: read`)
     - checkout caller repo/ref
     - setup Node
     - run composite action
     - outputs `matrix`
  2) `publish-packages` (permissions: `contents: read`, `packages: write`)
     - matrix include from `analyze.outputs.matrix`
     - setup Nix, pnpm, Node (registry configured)
     - build once; per-package summary always; conditionally publish when `dry_run` is false and package `action` is `publish`
- Matrix strategy: `fail-fast: false` to avoid cascade failures.
- Summary: Always appended; includes package, local/published versions, change type, and planned action; indicates "DRY RUN" when applicable.

### Authentication
- Use `GITHUB_TOKEN`:
  - `packages: read` for analysis,
  - `packages: write` for publishing.
- Registry URL: `https://npm.pkg.github.com`

### Package Requirements
- Valid `package.json` with `name` and `version`.
- Located under `packages/*`. Private packages are supported via GHCR auth.

### Publishing Strategy
- Per-package decision from analysis output (`action`).
- No retries or rollbacks (MVP).
- Environment via `nix develop .#pulumi`.

## Consequences

### Positive
- Reusable and caller-controlled triggering.
- Transparent analysis with consistent summaries.
- Clear dry-run behavior; lower risk before release.
- Encapsulated shell in composite action improves readability and reuse.

### Negative
- Adds dependency on GHCR npm metadata availability and auth.
- Basic semver classification (prerelease nuances deferred).
- Slightly more moving parts (action + workflow).

## Alternatives Considered
- Keep logic inline in workflow (harder to maintain as it grows).
- Use GitHub Packages REST API for versions (more complex mapping to repo).
- Implement a Node-based action with the `semver` library (heavier footprint).

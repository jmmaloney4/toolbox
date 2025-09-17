# ADR-003: pnpm Package Publishing to GHCR

**Status:** Proposed  
**Date:** 2024-12-19  
**Context:** Need to automatically publish pnpm packages to GitHub Container Registry (GHCR) npm registry on every tag push.

## Decision

Create a reusable GitHub Actions workflow that publishes all pnpm packages in `packages/*` to GHCR npm registry when tags are pushed.

## Rationale

- **Consistency:** Follows existing reusable workflow pattern used by `pulumi.yml`
- **Monorepo Support:** Handles multiple packages in `packages/*` directory
- **Nix Integration:** Uses existing Nix development environment for consistency
- **Reusability:** Can be called from other repositories via `workflow_call`
- **Independent Publishing:** Matrix strategy ensures each package publishes independently

## Implementation Details

### Workflow Structure
- Trigger: `on: push: tags: ['*']`
- Reusable: `workflow_call` with inputs for `runs-on`, `repository`, `ref`
- Package Detection: Scan `packages/*/package.json` for valid packages
- Publishing: Use `pnpm publish` with GHCR registry
- Matrix Strategy: `fail-fast: false` for independent package publishing

### Authentication
- Use `GITHUB_TOKEN` for GHCR authentication
- Registry URL: `https://npm.pkg.github.com`
- Required permissions: `contents: read`, `packages: write`

### Package Requirements
- Must be scoped with `@jmmaloney4/` prefix
- Must have valid `package.json` with version field
- Must be in `packages/*` directory

### Publishing Strategy
- Each package publishes independently in matrix
- No retry logic - fail fast on individual package failures
- No version validation against tag names
- Uses `nix develop .#pulumi` for consistent environment

## Consequences

### Positive
- Automated package publishing on tag push
- Consistent with existing workflow patterns
- Reusable across repositories
- Integrates with Nix development environment
- Independent package publishing prevents cascade failures

### Negative
- No version validation (assumes tags are correct)
- No rollback mechanism for failed publishes
- All packages published regardless of changes
- No retry logic for individual package failures

## Alternatives Considered
- Simple non-reusable workflow (less flexible)
- Marketplace actions (less control, Nix integration issues)
- Advanced features like version bumping (increased complexity)
- Retry logic (increased complexity, potential for infinite loops)

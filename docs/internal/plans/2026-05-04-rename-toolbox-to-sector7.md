# Rename toolbox → sector7

**Date:** 2026-05-04\
**Author:** jack\
**Status:** Draft

______________________________________________________________________

## Context

The repo `jmmaloney4/toolbox` is a shared infra repo providing:

- Reusable GitHub Actions workflows (nix, pnpm, rust, pulumi, claude, etc.)
- Composite actions (nix-setup, compute-flake-build-matrix, etc.)
- The `@jmmaloney4/toolbox` npm package (Sector7 Pulumi components)
- Renovate presets consumed by jackpkgs and this repo

"toolbox" is a generic name that doesn't reflect the actual product identity.
The npm package already lives under `packages/sector7/` and the Pulumi components
are branded Sector7. Renaming the repo aligns naming with reality.

GitHub provides indefinite HTTP redirects from the old name, but **GitHub Actions
`uses:` refs do not follow redirects** — they 404. This makes CI the critical
path for the rename.

______________________________________________________________________

## Scope

### In scope

- Rename GitHub repo `jmmaloney4/toolbox` → `jmmaloney4/sector7`
- Update all `uses:` refs in CI workflows (toolbox + jackpkgs)
- Update Renovate configs (toolbox + jackpkgs)
- Update `package.json` npm package name → `@jmmaloney4/sector7`
- Update documentation (README, AGENTS.md, docs/)

### Out of scope

- Pulumi stack names or config (no repo-name coupling found)
- Nix flake inputs (no repo-name coupling found)
- Historical ADR PR URLs (redirects keep them working; cosmetic only)

______________________________________________________________________

## Decision: npm package name

Rename from `@jmmaloney4/toolbox` to `@jmmaloney4/sector7`.

Rationale: The old name will confuse new consumers. Since all consumers are
internal (garden repo), the migration cost is a single `pnpm add` URL change and
any lockfile updates. No external consumers exist.

______________________________________________________________________

## Execution Plan

### Phase 0 — Pre rename

1. **Merge all open PRs.** Any PR branch still referencing `toolbox` in `uses:`
   will break post-rename.
2. **Coordinate timing.** Both toolbox and jackpkgs need updates within the same
   window to avoid CI gaps. Best done when no one is actively merging.

### Phase 1 — Rename the repo

1. GitHub → Settings → General → Repository name → `sector7` → Rename.
2. GitHub creates permanent redirect: `jmmaloney4/toolbox` → `jmmaloney4/sector7`.
3. Git remotes in local clones continue working (redirect). Optionally update
   the remote URL for cleanliness:
   ```sh
   git remote set-url origin git@github.com:jmmaloney4/sector7.git
   ```

### Phase 2 — Fix CI in sector7 (must be first commit after rename)

Find-and-replace across all workflow and action files:

```
jmmaloney4/toolbox/ → jmmaloney4/sector7/
```

**Files to update (~27 action/workflow refs):**

- `.github/workflows/nix.yml` (4 refs: push-nix-image, nix-setup ×3)
- `.github/workflows/rust.yml` (3 refs: nix-setup)
- `.github/workflows/pulumi.yml` (4 refs: nix-setup, detect-pulumi-stacks, pulumi-setup, pulumi-preview)
- `.github/workflows/pnpm.yml` (3 refs: analyze-pnpm-packages, nix-setup ×2)
- `.github/workflows/push-nix-image.yml` (2 refs: nix-setup, push-nix-image)
- `.github/workflows/quarto.yml` (1 ref: nix-setup)
- `.github/workflows/adr-management.yml` (2 refs: check-adr-conflicts, create-adr-placeholder)
- `.github/workflows/_dogfood-pnpm.yml` (1 ref)
- `.github/workflows/_dogfood-nix.yml` (1 ref)
- `.github/workflows/_dogfood-claude.yml` (1 ref)
- `.github/workflows/_dogfood-claude-review.yml` (1 ref)
- `.github/workflows/_dogfood-add-to-project.yml` (1 ref)
- `.github/workflows/_dogfood-adr-management.yml` (1 ref)
- `.github/actions/pulumi-setup/action.yml` (1 ref: nix-setup)

**Renovate configs (~8 refs):**

- `renovate/all.json` (7 preset URLs: `github>jmmaloney4/toolbox//renovate/...`)
- `renovate/default.json` (1 `matchPackageNames` entry)

**npm package:**

- `package.json` — `"name": "@jmmaloney4/toolbox"` → `"@jmmaloney4/sector7"`
- `packages/sector7/package.json` — same change if it carries its own name

**Commit:** `chore: rename repo references toolbox → sector7`

Push immediately. CI should come back green on `main`.

### Phase 3 — Fix CI in jackpkgs

Same find-and-replace in the jackpkgs repo:

**Workflow files (5 refs):**

- `.github/workflows/nix.yml`
- `.github/workflows/adr-management.yml`
- `.github/workflows/add-to-project.yml`
- `.github/workflows/claude.yml`
- `.github/workflows/claude-review.yml`

**Renovate (1 ref):**

- `.github/renovate.json`

**Commit:** `chore: update workflow refs for toolbox → sector7 rename`

### Phase 4 — Update documentation

Lower urgency — old URLs redirect — but do it to avoid confusion.

**In sector7 repo:**

- `README.md` — workflow usage examples, renovate preset URLs
- `AGENTS.md` — composite action example ref
- `docs/public/renovate.md` — preset documentation
- `docs/public/pulumi.md` — `pnpm add` URLs
- `renovate/README.md` — same as docs/public/renovate.md
- `packages/sector7/README.md` — `pnpm add` URLs

**In jackpkgs:**

- `docs/internal/designs/013-ci-devshells.md` — 2 URLs
- `docs/internal/designs/023-return-to-pnpm.md` — npm registry ref
- `docs/internal/plans/2026-01-31-return-to-pnpm.md` — npm registry ref
- `docs/internal/plans/2026-02-01-pnpm-migration-spike-plan.md` — npm registry ref
- `docs/internal/plans/2026-02-18-return-to-pnpm.md` — npm registry ref

### Phase 5 — Publish new npm package

1. `pnpm version minor` — bump version to signal the rename.
2. Publish `@jmmaloney4/sector7` to GitHub Packages.
3. In garden repo: update `package.json` and `.npmrc` to use `@jmmaloney4/sector7`.
4. Optionally unpublish `@jmmaloney4/toolbox` (or leave it as a deprecated stub).

### Phase 6 — Cleanup

- Update Hermes skills referencing `toolbox` (memory + skill files).
- Update brain2 notes referencing `toolbox`.
- Update any other local clones' git remotes for cleanliness.

______________________________________________________________________

## Risks

| Risk | Mitigation |
|---|---|
| CI breaks between rename and first push | Phase 2 is a single commit; push immediately after rename. Window is <5 min. |
| jackpkgs CI breaks during the gap | Phase 3 immediately after Phase 2. Same session. |
| Open PRs in either repo break | Phase 0: merge or close all open PRs first. |
| `uses:` refs with SHA pins still say `toolbox` | The SHA pin means GitHub resolves by hash; the repo redirect handles the lookup. But updating the string is still correct for clarity. |
| npm consumers can't find old package | Phase 5 publishes under new name. Old package stays readable on GitHub Packages. |
| Renovate can't find presets | Phase 2 updates `renovate/all.json` self-refs. Phase 3 updates jackpkgs. Renovate reads config from the default branch, so this is fixed on push. |

______________________________________________________________________

## Reference counts

| Category | Refs |
|---|---|
| sector7 repo: workflow `uses:` (actions) | 26 |
| sector7 repo: composite action `uses:` | 1 |
| sector7 repo: renovate JSON configs | 8 |
| sector7 repo: package.json | 1 |
| sector7 repo: docs/README | ~40 lines |
| jackpkgs: workflow `uses:` | 5 |
| jackpkgs: renovate.json | 1 |
| jackpkgs: docs | ~6 lines |
| **Total** | **~88 references** |

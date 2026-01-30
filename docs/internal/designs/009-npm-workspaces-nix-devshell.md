---
id: ADR-009
title: npm Workspaces in Nix Devshells
status: Accepted
date: 2026-01-30
deciders: [@jmmaloney4]
consulted: []
tags: [design, adr, nix, npm]
supersedes: []
superseded_by: []
links: []
---

# Context
- We need to build TypeScript packages in our nix devshell environment
- npm workspaces create symlinks in `node_modules/` that point to workspace packages (e.g., `node_modules/@jmmaloney4/sector7 -> ../../packages/sector7`)
- During nix build, these symlinks are incorrectly rewritten to absolute paths (e.g., `/nix/store/packages/sector7`) which do not exist
- The `fixupPhase` in nix builds detects these broken symlinks and fails the build
- This prevents the devshell from building successfully

# Decision
- Do NOT use the npm `workspaces` configuration field in `package.json`
- Instead, build workspace packages explicitly using the `--workspace=<path>` flag: `npm run build --workspace=packages/sector7`
- Build scripts use explicit workspace targeting rather than the `-ws` (all workspaces) flag
- This prevents npm from creating problematic symlinks during the nix build process

# Consequences
## Positive
- Devshell builds complete successfully without broken symlink errors
- Maintains ability to work with multiple packages in a monorepo structure
- Explicit workspace targeting is more intentional and easier to debug

## Negative
- Slightly more verbose build commands (need to specify `--workspace=<path>` for each package)
- Can't use `-ws` flag to build all workspaces at once

# Alternatives
- **Keep workspaces config**: Would require custom nix post-build hooks to fix symlinks, complex and fragile
- **Use pnpm workspaces**: pnpm uses a different symlink strategy that may not have the same issue, but jackpkgs ADR-019 mandates npm
- **Disable npm link-workspace-packages**: npm has a `--link-workspace-packages=false` flag, but this still creates broken symlinks during nix build
- **Build packages individually outside npm**: More complex setup, loses npm's convenience features

# Security / Privacy / Compliance
- No security or privacy implications

# Operational Notes
- When adding new packages to `packages/`, update build scripts to include `--workspace=packages/<new-package>`
- Local development can still use workspaces if needed (workspaces config can be added conditionally)

# Status Transitions
- N/A

# Implementation Notes
- Build script in root `package.json`: `"build": "npm run build --workspace=packages/sector7"`
- This approach works with jackpkgs `buildnpmpackage` module and `npmBuildHook`

# References
- jackpkgs ADR-019: Use npm instead of pnpm
- npm workspaces documentation: https://docs.npmjs.com/cli/v10/using-npm/workspaces

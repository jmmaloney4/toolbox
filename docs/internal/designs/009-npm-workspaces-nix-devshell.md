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
links: [jackpkgs ADR-019, jackpkgs ADR-020]
---

# Context

We need to build TypeScript packages in our nix devshell environment using jackpkgs' `buildNpmPackage` module.

## The Problem

npm workspaces create symlinks in `node_modules/` pointing to workspace packages:
```
node_modules/@jmmaloney4/sector7 -> ../../packages/sector7
```

During nix build:
1. `npmConfigHook` runs `npm install` which creates these workspace symlinks
2. `buildNpmPackage`'s `installPhase` copies `node_modules` to `$out`
3. Nix's `fixupPhase` attempts to rewrite symlinks but incorrectly produces `/nix/store/packages/sector7` (missing derivation hash prefix)
4. `noBrokenSymlinks` check detects dangling symlinks and fails the build

## Root Cause

jackpkgs ADR-020 documents that `buildNpmPackage` uses:
```nix
installPhase = ''
  cp -R node_modules $out
'';
```

This copies workspace symlinks verbatim, which then break because they point outside the nix store.

# Decision

**Do NOT use npm `workspaces` in `package.json` or `package-lock.json`** for projects using jackpkgs' nix devshells.

Instead:
1. Keep workspace packages in `packages/` directory (monorepo structure)
2. Build packages explicitly: `cd packages/sector7 && npm run build`
3. Ensure `package-lock.json` does not contain `workspaces` field (regenerate if needed)

# Consequences

## Positive
- Devshell builds complete successfully
- Maintains monorepo structure for code organization
- Simple, explicit build commands

## Negative
- Cannot use npm workspace features (`-ws` flag, cross-package `npm install`)
- Must manually manage inter-package dependencies if needed
- Build commands are slightly more verbose

## Neutral
- For projects with no inter-package dependencies (like this one), there's no practical difference

# Alternatives Considered

## 1. Fix jackpkgs to Handle Workspaces
**Approach**: Modify jackpkgs `nodejs.nix` to remove workspace symlinks before copying:
```nix
installPhase = ''
  find node_modules -type l -lname '../../*' -delete
  cp -R node_modules $out
'';
```

**Status**: Deferred. Would require upstream PR to jackpkgs. Current workaround is simpler.

## 2. Use `cp -RLH` to Follow Symlinks
**Approach**: Copy actual files instead of symlinks.
**Why not**: Would duplicate workspace package contents, increasing derivation size.

## 3. Use pnpm Workspaces
**Why not**: jackpkgs ADR-019 mandates npm.

## 4. Custom postInstall to Fix Symlinks
**Approach**: In consumer flake, add `postInstall` to recreate symlinks with relative paths.
**Why not**: Adds complexity to every consumer; better to avoid workspaces entirely.

# Implementation

## Required Changes

1. **`package.json`**: No `workspaces` field
2. **`package-lock.json`**: Regenerate without workspaces (`rm package-lock.json && npm install --package-lock-only`)
3. **Build scripts**: Use explicit paths (`cd packages/sector7 && npm run build`)
4. **Sub-package scripts**: Use `npm` not `pnpm` (e.g., `prepack`)
5. **`flake.nix`**: Remove `pnpm` from devShell `buildInputs`

## Verification

After changes, verify lockfile has no workspaces:
```bash
grep -c workspaces package-lock.json  # Should output 0
```

# Security / Privacy / Compliance

No security or privacy implications.

# References

- jackpkgs ADR-019: Migrate from pnpm to npm
- jackpkgs ADR-020: Migrate from dream2nix to buildNpmPackage (documents `installPhase` behavior)
- npm workspaces documentation: https://docs.npmjs.com/cli/v10/using-npm/workspaces
- Nix `noBrokenSymlinks` check: Part of standard fixup phase

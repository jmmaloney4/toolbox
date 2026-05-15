---
id: ADR-019
title: Compile sector7 Packages Before Distribution
status: Proposed
date: 2026-05-06
deciders: [jmmaloney4]
consulted: [addendalabs/yard]
tags: [design, adr, pnpm, typescript, packaging]
supersedes: []
superseded_by: []
links:
  - '[ADR-018](./018-pnpm-release-tarball-artifacts.md)'
  - https://github.com/addendalabs/yard/pull/1146
---

# Context

ADR-018 made GitHub Release tarball assets the default distribution path for Sector7 pnpm packages. That fixed the Nix/pnpm failure mode where GitHub codeload or git dependencies required `git`, SSH, credentials, or installed the monorepo root instead of the package root.

The first release tarball still shipped raw TypeScript source and exported `.ts` files directly:

```json
"exports": {
  "./nix-image": {
    "types": "./nix-image/index.ts",
    "default": "./nix-image/index.ts"
  }
}
```

That works only when every consumer has a runtime TypeScript loader willing to transpile files under `node_modules`. Pulumi's `typescript: true` Node.js runtime uses `ts-node`, and `ts-node` ignores `node_modules` by default. A Yard deployment failed with:

```text
ERR_UNKNOWN_FILE_EXTENSION .ts .../node_modules/@jmmaloney4/sector7/nix-image/index.ts
Hint: ts-node is configured to ignore this file.
```

This is a packaging problem, not a Yard runtime problem. Sector7 packages are runtime libraries. Consumers should not need custom loader flags, `ts-node` `skipIgnore`, or `tsx/esm` just because they import Sector7.

In scope:

- Sector7 package tarball shape.
- Sector7 package export targets.
- Release workflow checks that prevent uploading raw-source runtime packages.

Out of scope:

- Replacing TypeScript as Sector7's authoring language.
- Publishing to npmjs or GitHub Packages.
- Bundling Pulumi peer dependencies into Sector7.

# Decision

Sector7 packages MUST compile TypeScript before packaging.

Published package tarballs MUST contain:

- compiled JavaScript runtime files under `dist/`,
- generated `.d.ts` declaration files under `dist/`,
- non-TypeScript runtime assets needed by those compiled files, such as shell scripts.

Published package tarballs MUST NOT expose raw `.ts` source files as runtime entrypoints.

`package.json` exports MUST point runtime consumers at compiled `.js` files and TypeScript consumers at generated `.d.ts` files:

```json
"exports": {
  "./nix-image": {
    "types": "./dist/nix-image/index.d.ts",
    "default": "./dist/nix-image/index.js"
  }
}
```

The release workflow MUST build packages before packing and MUST fail before upload if the packed tarball contains raw `.ts` runtime files or is missing `dist/index.js` / `dist/index.d.ts`.

Sector7 MAY continue to publish as GitHub Release tarball assets per ADR-018. This ADR refines the contents of those tarballs, not the distribution channel.

# Consequences

## Positive

- Consumers can import Sector7 from ordinary Node.js runtimes without custom TypeScript loaders.
- Pulumi stacks can use their default TypeScript runtime without depending on `tsx/esm` or `ts-node` `skipIgnore`.
- The package behaves like a normal npm package even when distributed as a GitHub Release tarball.
- Generated declaration files give consumers a stable type surface decoupled from Sector7's source layout.
- Release workflow validation catches regressions before a broken artifact is uploaded.

## Negative

- Releases now depend on a build step and can fail if TypeScript compilation fails.
- Tarballs are larger because they include JavaScript, declaration files, and source maps.
- Runtime assets such as shell scripts must be copied into `dist/` when compiled code resolves them relative to `import.meta.url`.
- Source files are no longer the published contract; debugging may rely on source maps rather than direct `.ts` execution.

# Alternatives

- **Keep publishing raw TypeScript and require `tsx/esm` in consumers**: Fastest short-term fix. It works for Yard after changing Pulumi.yaml, but it leaks Sector7's packaging choice into every consumer and produces non-obvious failures in new stacks.
- **Configure `ts-node` with `skipIgnore` or custom ignore patterns**: Keeps Pulumi's `typescript: true` runtime, but widens TypeScript transpilation across `node_modules`, is consumer-specific, and remains fragile across runtimes.
- **Bundle Sector7 into a single JavaScript file**: Reduces package files but complicates Pulumi peer dependency handling and makes subpath exports less transparent. Sector7 should preserve normal package/module shape for now.
- **Compile to `dist/` with declarations**: Standard package behavior. Slightly more release machinery, but consumers need no special runtime behavior. This is the selected option.

# Security / Privacy / Compliance

No credentials or private data are introduced. The release workflow should continue to use the existing GitHub token only for release asset upload. Build outputs must not include local paths, generated credentials, `.npmrc`, Pulumi stack state, or environment-specific files.

# Operational Notes

- `pnpm pack` should run the package `prepack` script locally and in CI, so manually created release artifacts have the same shape as CI-created artifacts.
- The release workflow should inspect the packed tarball, not just the source tree. The artifact is the contract.
- If a consumer reports `ERR_UNKNOWN_FILE_EXTENSION .ts` from `node_modules/@jmmaloney4/sector7`, treat that as a failed release packaging invariant.
- If compiled code resolves non-JS assets with `import.meta.url`, copy those assets into the matching `dist/` directory during build.

# Status Transitions

- Amends ADR-018 by defining the required contents of release tarball assets.
- ADR-018 remains the distribution-channel decision.

# Implementation Notes

- Add `packages/sector7/tsconfig.build.json` to emit JavaScript, declarations, declaration maps, and source maps to `dist/`.
- Use TypeScript `rewriteRelativeImportExtensions` so source imports ending in `.ts` compile to `.js` import specifiers.
- Update `packages/sector7/package.json` exports to point at `dist/**/*.js` and `dist/**/*.d.ts`.
- Limit `files` to `dist` and README-level package metadata.
- Add `build`, `clean`, and `prepack` scripts so local `pnpm pack` and release workflow `pnpm pack` both produce compiled artifacts.
- Copy `scripts/*.sh` into `dist/scripts/` because `getScriptPath()` resolves next to compiled `dist/scripts/index.js`.
- Update the reusable pnpm release workflow to validate compiled tarball shape before `gh release create`.

# References

- [ADR-018: pnpm Package Release Tarball Artifacts](./018-pnpm-release-tarball-artifacts.md)
- Yard PR using Sector7 release tarball: https://github.com/addendalabs/yard/pull/1146
- ts-node scope/ignore behavior: https://typestrong.org/ts-node/docs/scope
- TypeScript `rewriteRelativeImportExtensions`: https://www.typescriptlang.org/tsconfig/#rewriteRelativeImportExtensions

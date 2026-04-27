// Barrel guard: ensure R2Object and related types are NOT re-exported from
// the main workersite barrel. They live on the sibling @jmmaloney4/sector7/r2
// sub-path (ADR-014). If someone re-adds them to index.ts, the guard
// directives below become unused and TypeScript fails CI.

import * as workersite from "./index.ts";

// @ts-expect-error — R2Object lives on the sibling ./r2 sub-path only
const _r2ObjectGuard = workersite.R2Object;

// @ts-expect-error — AssetFile lives on the sibling ./r2 sub-path only
type _AssetFileGuard = workersite.AssetFile;

// @ts-expect-error — AssetConfig lives on the sibling ./r2 sub-path only
type _AssetConfigGuard = workersite.AssetConfig;

// @ts-expect-error — uploadAssets lives on the sibling ./r2 sub-path only
const _uploadAssetsGuard = workersite.uploadAssets;

// @ts-expect-error — uploadStaticAssets lives on the sibling ./r2 sub-path only
const _uploadStaticAssetsGuard = workersite.uploadStaticAssets;

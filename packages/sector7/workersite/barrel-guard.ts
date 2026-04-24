// Barrel guard: ensure R2Object and related types are NOT re-exported from
// the main workersite barrel.  They live on the ./r2 sub-path (ADR-014).
// If someone re-adds them to index.ts, the @ts-expect-error directives
// will produce "Unused '@ts-expect-error' directive" errors and fail CI.

// @ts-expect-error — R2Object lives on ./workersite/r2 sub-path only
import { R2Object } from "./index.ts";

// @ts-expect-error — AssetFile lives on ./workersite/r2 sub-path only
import { type AssetFile } from "./index.ts";

// @ts-expect-error — AssetConfig lives on ./workersite/r2 sub-path only
import { type AssetConfig } from "./index.ts";

// @ts-expect-error — uploadAssets lives on ./workersite/r2 sub-path only
import { uploadAssets } from "./index.ts";

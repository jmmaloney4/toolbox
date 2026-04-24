/**
 * Type-level regression guard: R2Object must NOT be re-exported from the main
 * workersite barrel.  This file is type-checked by its own tsconfig
 * (tsconfig.barrel-guard.json) as part of CI.
 *
 * If someone adds `export * from "./r2object.ts"` back to index.ts, the
 * @ts-expect-error directives become unused and tsc fails.
 */

// @ts-expect-error — R2Object lives on the ./r2 sub-path, not the main barrel
import type { R2Object } from "./index.ts";

// @ts-expect-error — R2ObjectInputs lives on the ./r2 sub-path
import type { R2ObjectInputs } from "./index.ts";

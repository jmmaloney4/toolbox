# Decouple R2 Upload from WorkerSite

**Date:** 2026-04-24\
**Author:** jack\
**Status:** Draft\
**Related ADR:** [ADR-014](../designs/014-decouple-r2-from-workersite.md)\
**Related issues:** toolbox#155\
**Related PRs:** toolbox#156 (partial fix, review identified deeper issue)

______________________________________________________________________

## Context

PR #156 moved `R2Object` to a sub-path export but left `WorkerSite` statically
importing it. Three reviewers (Gemini, Copilot, Cursor) all identified that the
transitive import chain `index.ts → worker-site.ts → r2object.ts → @aws-sdk/client-s3`
remains unbroken. The real fix is architectural: decouple R2 upload from
WorkerSite entirely, as documented in ADR-014.

This plan covers the implementation of that decoupling. All consumers are
internal (garden repo), so breaking changes are acceptable.

______________________________________________________________________

## PR Sequence

### PR 1 — Extract `uploadAssets` helper to r2 sub-path

**Goal:** WorkerSite no longer imports R2Object. A new `uploadAssets` function
in the `./workersite/r2` sub-path handles R2 uploads using WorkerSite outputs.

**Background:**

Currently `WorkerSite` does three things related to R2:

1. Creates an R2 bucket (via `cloudflare.R2Bucket`) when `r2Bucket.create: true`
2. Creates an R2 API token (via `R2Token` dynamic resource) when `assets` is provided
3. Loops over `assets.files`, creating `new R2Object(...)` for each file

Steps 2 and 3 are the upload concern. Step 1 (bucket creation) is
infrastructure and stays in WorkerSite.

**Steps for the analyst:**

1. **Audit WorkerSite for R2Object coupling:**

   ```sh
   cd packages/sector7/workersite
   grep -n 'R2Object\|uploadedAssets\|assets' worker-site.ts
   ```

   Key locations:

   - Line 4: `import { R2Object } from "./r2object.ts"`
   - `WorkerSiteArgs.assets` property (the `AssetConfig` input)
   - Line 434: `public readonly uploadedAssets: R2Object[]`
   - Lines 730-770: R2 token creation + `new R2Object()` loop
   - Line 783: `registerOutputs({ uploadedAssets: this.uploadedAssets })`

2. **Add output properties to WorkerSite for R2 credentials:**

   WorkerSite already creates the R2 token internally. Expose the token's
   outputs so the upload helper can use them:

   ```ts
   // New outputs on WorkerSite
   public readonly r2AccessKeyId: pulumi.Output<string> | undefined;
   public readonly r2SecretAccessKey: pulumi.Output<string> | undefined;
   public readonly r2BucketName: pulumi.Output<string> | undefined;
   ```

   These are `undefined` when no bucket is created. The R2 token creation
   stays inside WorkerSite for now (it's tied to the bucket lifecycle), but
   the upload loop moves out.

3. **Remove `assets` from `WorkerSiteArgs`:**

   Move `AssetConfig` (file list) to be a parameter of the new `uploadAssets`
   function instead. Remove `assets` from `WorkerSiteArgs`.

4. **Remove R2Object import and upload loop from WorkerSite:**

   - Delete `import { R2Object } from "./r2object.ts"`
   - Delete `public readonly uploadedAssets: R2Object[]`
   - Delete the R2 token creation + upload loop (lines ~730-770)
   - Delete `uploadedAssets` from `registerOutputs`

5. **Create `uploadAssets` function in `r2object.ts` (or new file):**

   ```ts
   // packages/sector7/workersite/r2.ts (or r2object.ts)

   export interface UploadAssetsArgs {
     accountId: pulumi.Input<string>;
     bucketName: pulumi.Input<string>;
     accessKeyId: pulumi.Input<string>;
     secretAccessKey: pulumi.Input<string>;
     files: AssetFile[];
     dependsOn?: pulumi.Resource[];
   }

   export function uploadAssets(
     name: string,
     args: UploadAssetsArgs,
     opts?: pulumi.ComponentResourceOptions,
   ): R2Object[] { ... }
   ```

   This function takes the outputs from WorkerSite (bucket name, credentials)
   and the file list, creates `new R2Object()` for each file, returns the array.

6. **Replace dynamic `typeof import` with static import:**

   Since `r2object.ts` is now behind the r2 sub-path with an honest required
   peer dep, the dynamic import + `typeof import()` cast can be simplified:

   ```ts
   // Before (r2object.ts)
   const { S3Client, PutObjectCommand } = (await import(
     "@aws-sdk/client-s3"
   )) as typeof import("@aws-sdk/client-s3");

   // After — static import at top of file
   import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
   ```

   This is cleaner and gets full type safety without the cast complexity.
   The dep is required for the sub-path, so there's no reason to defer the
   import.

7. **Update `r2.ts` barrel to use named re-exports:**

   ```ts
   // r2.ts
   export {
     R2Object,
     type R2ObjectInputs,
     uploadAssets,
     type UploadAssetsArgs,
   } from "./r2object.ts";
   ```

8. **Update `barrel-guard.ts`** to remove stale `tsconfig.barrel-guard.json`
   reference and add guards for `uploadAssets`/`UploadAssetsArgs`.

9. **Verify:**

   ```sh
   cd packages/sector7 && pnpm tsc --noEmit
   ```

   Confirm:

   - `worker-site.ts` has zero references to `R2Object`
   - `r2object.ts` uses static imports, no `typeof import()` casts
   - Main barrel does not re-export anything from r2 sub-path

**Acceptance criteria:**

- `grep -r 'R2Object' packages/sector7/workersite/worker-site.ts` returns empty
- `grep -r 'typeof import' packages/sector7/workersite/r2object.ts` returns empty
- `pnpm tsc --noEmit` passes in `packages/sector7`
- Importing `WorkerSite` from `@jmmaloney4/sector7/workersite` does not require
  `@aws-sdk/client-s3` in `node_modules`

______________________________________________________________________

### PR 2 — Migrate consumers (garden repo)

**Goal:** Update all consumers in the garden repo to use the new `uploadAssets`
API.

**Background:**

Theoretical Edge and other consumers in `garden` currently pass `assets` to
`WorkerSiteArgs` and read `site.uploadedAssets`. They need to call
`uploadAssets()` separately.

**Steps for the analyst:**

1. Search garden repo for `uploadedAssets` and `assets:` in WorkerSite
   instantiations.

2. For each consumer:

   - Remove `assets` from `WorkerSiteArgs`
   - Add `import { uploadAssets } from "@jmmaloney4/sector7/workersite/r2"`
   - After WorkerSite creation, call:
     ```ts
     const uploadedAssets = uploadAssets(`${name}-assets`, {
       accountId: args.accountId,
       bucketName: site.r2BucketName!,
       accessKeyId: site.r2AccessKeyId!,
       secretAccessKey: site.r2SecretAccessKey!,
       files: assetFiles,
       dependsOn: [site],
     });
     ```

3. Add `@aws-sdk/client-s3` as a dependency in the consumer's `package.json`
   (required for the r2 sub-path).

4. Verify with `pnpm tsc --noEmit`.

**Acceptance criteria:**

- No consumer references `WorkerSiteArgs.assets` or `site.uploadedAssets`
- All consumers using R2 upload import from `./workersite/r2`
- `pnpm tsc --noEmit` passes in each consumer package

______________________________________________________________________

## Suggested Merge Order

```
PR 1 (toolbox: extract uploadAssets)  →  PR 2 (garden: migrate consumers)
```

PR 1 is self-contained and can be merged independently. PR 2 can happen in
parallel since garden references sector7 from the registry, but should be
coordinated so both land before the next deployment.

______________________________________________________________________

## Definition of Done

- [ ] `WorkerSite` has zero imports from `r2object.ts`
- [ ] `r2object.ts` uses static imports for `@aws-sdk/client-s3` (no `typeof import` casts)
- [ ] `uploadAssets` function exported from `./workersite/r2` sub-path
- [ ] Main barrel (`./workersite/index.ts`) has no transitive path to `@aws-sdk/client-s3`
- [ ] Barrel-guard type test passes (R2Object not on main barrel)
- [ ] All garden consumers migrated
- [ ] Issue #155 closed

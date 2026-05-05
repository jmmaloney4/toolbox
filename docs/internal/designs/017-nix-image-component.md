---
id: ADR-017
title: NixImage Pulumi Component for nix2container Build-Push
status: Accepted
date: 2026-05-05
deciders: [jmmaloney4]
tags: [design, adr]
supersedes: []
superseded_by: []
links: [ADR-016]
---

# Context

Multiple repositories (yard, zeus, and potentially others) build container images
using nix2container and push them to Google Artifact Registry. Currently each
repo carries its own build-push script with slight variations in logging, auth,
and digest extraction. This leads to duplicated effort and divergent behavior.

The nix2container workflow follows a consistent pattern:

1. `nix build` the image derivation
2. Authenticate to Artifact Registry via `gcloud auth print-access-token`
3. `skopeo copy` the image to the registry
4. Extract the digest for downstream Pulumi resource wiring

A shared Pulumi ComponentResource can encapsulate this pattern so consumers
declare the image they want and get back a stable `imageRef` output with digest,
just like any other Pulumi resource.

# Decision

Create a `NixImage` ComponentResource at `@jmmaloney4/sector7/nix-image` with
type token `sector7:nix:NixImage`.

```ts
import { NixImage } from "@jmmaloney4/sector7/nix-image";

const img = new NixImage("lens-api", {
  nixAttr: "packages.x86_64-linux.lens-api-image",
  imageName: "lens-api",
  imageTag: "dev",
  artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
  repoRoot: "/home/user/my-repo",
});

// img.imageRef → "registry/lens-api@sha256:..."
// img.digest → "sha256:..."
```

The component MUST:

- Delegate actual build+push to an external bash script
  (`packages/sector7/scripts/nix-image-build-push.sh`), not inlined bash in
  the Pulumi program. External scripts are easier to test locally and keep
  the TypeScript thin.
- Use a `DIGEST_OUTPUT:` marker convention in the script's stdout so the
  component can reliably parse the digest from `command.local.Command` stdout.
- Support two modes via the `mode` arg:
  - `"build"` (default): runs the full build+push pipeline.
  - `"resolve"`: skips build, uses `skopeo inspect` to resolve the digest of an
    already-pushed tag. Useful when the image was built elsewhere (e.g. CI) and
    Pulumi just needs the digest for wiring.
- Default triggers to `[imageTag]` so Pulumi re-runs the command when the tag
  changes.

# Consequences

## Positive

- Single source of truth for nix2container build-push logic across repos.
- Consumers get a Pulumi-native experience: declare, plan, apply.
- `resolve` mode supports CI-built images without requiring Pulumi to run the
  nix build itself.
- `DIGEST_OUTPUT:` marker convention is simple and grep-friendly.
- Script is independently testable outside Pulumi.

## Negative

- Adds `@pulumi/command` as a peer dependency.
- The bash script depends on `nix`, `skopeo-nix2container`, and `gcloud` being
  available on the Pulumi runner.
- `command.local.Command` stores stdout in state — large build logs could bloat
  state if not managed carefully.

# Alternatives

### 1. In-repo scripts (status quo)

Pros:
- No shared dependency.
- Each repo can customize freely.

Cons:
- Duplicated auth, logging, and digest extraction logic.
- Divergent behavior across repos.
- Changes require updating multiple repos.

Rejected: the pattern is stable enough to share.

### 2. Inline bash in Pulumi program

Pros:
- No separate script file to manage.

Cons:
- Hard to test locally without Pulumi.
- Escaping and readability issues in template strings.
- Cannot be run standalone for debugging.

Rejected: external script is more maintainable.

### 3. NixImage in yard or zeus (not sector7)

Pros:
- Closer to the consumer.

Cons:
- Other repos would depend on yard or zeus just for image building.
- sector7 exists precisely for shared infrastructure components.

Rejected: sector7 is the correct home for reusable Pulumi components.

# Security / Privacy / Compliance

- The script authenticates to Artifact Registry using `gcloud auth print-access-token`.
  The token is written to a temporary auth file that is cleaned up on exit (trap).
- No credentials are stored in Pulumi state beyond the command environment.
- The `DIGEST_OUTPUT` marker is informational and contains no secrets.

# Operational Notes

- The script creates a log file under `COMMAND_LOG_STEM` (default
  `.pulumi/command-logs/`) for each build, capturing full output.
- The `RESULT_LINK` symlink is cleaned up on script exit.
- `resolve` mode is lightweight and does not require nix or gcloud — only
  skopeo (via nix2container) with read access to the registry.
- Default trigger is `[imageTag]`, so changing the tag forces a new build.
  Consumers can pass custom triggers (e.g. a commit SHA) for finer control.

# Status Transitions

- Follows the component extraction pattern established by ADR-016 (AccessGate).

# Implementation Notes

1. Create `packages/sector7/scripts/nix-image-build-push.sh` (external bash script).
2. Create `packages/sector7/scripts/index.ts` (script path resolver).
3. Create `packages/sector7/nix-image/nix-image.ts` (ComponentResource).
4. Create `packages/sector7/nix-image/index.ts` (barrel export).
5. Add `./nix-image` and `./scripts` sub-path exports to `package.json`.
6. Add `@pulumi/command` to peerDependencies and devDependencies.
7. Add `nixImage` barrel export to `packages/sector7/index.ts`.
8. Add tests in `packages/sector7/tests/nix-image.test.ts`.
9. Add ADR-017.

# References

- ADR-016: Extract Access into AccessGate (established ComponentResource pattern)
- nix2container: https://github.com/nlewo/nix2container
- hq Front issue: ergodicsystems/hq#135

workflows

Reusable GitHub Actions workflows and composite actions for CI/CD across repositories. Examples below reflect what exists in this repository today. Pin to a tag or commit SHA when available; examples use `@main` for clarity.

How To Use

- Reusable workflows: call them as jobs with `uses: jmmaloney4/workflows/.github/workflows/<file>@main`.
- Composite actions: call them as steps with `uses: jmmaloney4/workflows/.github/actions/<name>@main`.

Reusable Workflows

- rust.yml: Rust CI (check, test, clippy) using Nix.
  Example:
  ```yaml
  jobs:
    rust:
      uses: jmmaloney4/workflows/.github/workflows/rust.yml@main
      with:
        flake-ref: "."
        test-runner: "nextest"  # or "cargo-test"
        clippy-args: "--all-targets --all-features"
  ```

- nix.yml: Nix flake builds with cache warming and uncached-output matrix.
  Example:
  ```yaml
  jobs:
    nix:
      uses: jmmaloney4/workflows/.github/workflows/nix.yml@main
      with:
        runs-on: "ubuntu-latest"
        max-parallel: 2
        probe-timeout: 180
        cache-version: "v1"
        # Optional: enable pushing images (packages named *-image)
        push-images: true
        image-repo-prefix: "ghcr.io/your-org/your-project"
  ```

- nix-flake-update.yml: Update `flake.lock` and open a PR.
  Example:
  ```yaml
  on:
    workflow_dispatch:
    schedule:
      - cron: '0 0 1 * *'
  jobs:
    nix-flake-update:
      uses: jmmaloney4/workflows/.github/workflows/nix-flake-update.yml@main
      with:
        branch: "nix-flake-update"
        commit-msg: "nix flake update"
        pr-title: "nix flake update"
        pr-assignees: ""
  ```

- pulumi.yml: Pulumi preview and deploy with optional stack auto-detection.
  Example:
  ```yaml
  jobs:
    pulumi:
      uses: jmmaloney4/workflows/.github/workflows/pulumi.yml@main
      with:
        environment: "stage"          # stage, prod, or both
        auto-detect-stacks: true
        gcp-project-id: "my-project"  # optional
        pulumi-backend: "gs://state-bucket"  # or use Pulumi Cloud via token
      secrets:
        GCP_WORKLOAD_IDENTITY_PROVIDER: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
        GCP_SERVICE_ACCOUNT_EMAIL: ${{ secrets.GCP_SERVICE_ACCOUNT_EMAIL }}
        PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
  ```

- docker.yml: Discover and build Dockerfiles (monorepo friendly) and push to a registry.
  Example:
  ```yaml
  jobs:
    docker:
      uses: jmmaloney4/workflows/.github/workflows/docker.yml@main
      with:
        dockerfile-pattern: "**/Dockerfile"
        registry: "ghcr.io"
        platforms: "linux/amd64,linux/arm64"
        max-parallel: 3
        build-changed-only: false
      secrets:
        REGISTRY_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```

Composite Actions

- docker-build: Build and optionally push Docker images; standard tags and metadata.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/docker-build@main
    with:
      image-name: "my-app"
      dockerfile-path: "./Dockerfile"
      docker-context: "./"
      registry: "ghcr.io"
      github-token: ${{ secrets.GITHUB_TOKEN }}
      platforms: "linux/amd64,linux/arm64"
      push: true
  ```

- docker-discover: Find Dockerfiles and emit a build matrix with full image names.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/docker-discover@main
    id: discover
    with:
      dockerfile-pattern: "**/Dockerfile"
      exclude-paths: "node_modules/**,target/**"
      registry: "ghcr.io"
  - run: |
      echo "Found: ${{ steps.discover.outputs.count }}"
      echo '${{ steps.discover.outputs.matrix }}' | jq '.'
  ```

- nix-setup: Install and configure Nix with common CI caching.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/nix-setup@main
    with:
      enable-flakehub-cache: true
      enable-magic-nix-cache: true
  ```

- nix-flake-detect: Detect flake outputs and produce a matrix of uncached work.
  Example (paired with `nix.yml` warm cache output):
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/nix-flake-detect@main
    id: detect
    with:
      probe-timeout: 180
      cache-key: ${{ needs.warm-cache.outputs.cache_key }}
  - run: echo '${{ steps.detect.outputs.matrix-include }}'
  ```

- nix-image-descriptors: Generate `images/*.env` descriptors from flake outputs for packages ending with `-image`.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/nix-image-descriptors@main
    id: images
    with:
      all-outputs-json: ${{ needs.detect.outputs.all_outputs }}
      out-dir: images
  - uses: actions/upload-artifact@v4
    if: ${{ steps.images.outputs.has-images == 'true' }}
    with:
      name: images
      path: images/*.env
      if-no-files-found: ignore
  ```

- nix-image-push: Push images described by `images/*.env` to a registry using the flake `passthru.copyTo` runner.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/nix-image-push@main
    if: ${{ hashFiles('images/*.env') != '' }}
    with:
      images-dir: images
      image-repo-prefix: ghcr.io/your-org/your-project
      github-token: ${{ secrets.GITHUB_TOKEN }}
  ```

- nix-fast-build: Build a flake attribute via `nix-fast-build`.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/nix-fast-build@main
    with:
      flake-attr: .#packages.x86_64-linux.myapp
  ```

- rust-cache-setup: Use a Nix devshell toolchain and configure Cargo cache.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/rust-cache-setup@main
    id: rust
    with:
      flake-ref: ".#rust-dev"
      cache-key-suffix: "ci"
  ```

- pulumi-setup: Configure Pulumi, optionally authenticating to GCP or AWS.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/pulumi-setup@main
    with:
      login-backend: "gs://my-pulumi-state"
      enable-gcp-auth: true
    env:
      GOOGLE_WORKLOAD_IDENTITY_PROVIDER: ${{ vars.GCP_WIP }}
      GOOGLE_SERVICE_ACCOUNT_EMAIL: ${{ vars.GCP_SA_EMAIL }}
  ```

- pulumi-stack-detect: Discover Pulumi stacks and emit `{project, stack}` matrix.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/pulumi-stack-detect@main
    id: stacks
    with:
      include-stacks: "stage,prod"
  - run: echo '${{ steps.stacks.outputs.matrix }}'
  ```

- pulumi-collect: Collect successful preview markers and produce deploy matrix.
  Example:
  ```yaml
  - uses: jmmaloney4/workflows/.github/actions/pulumi-collect@main
    id: collect
    with:
      kind: stage
  - run: echo '${{ steps.collect.outputs.matrix }}'
  ```

Conventions

- Pin versions in callers (tag or commit SHA). Use `@main` for testing.
- Workflows set conservative permissions; callers may restrict further.
- Pass secrets explicitly via `secrets:` or use `inherit` where appropriate.
- Inputs and outputs are documented in each file header.

Contributing

- Open a PR for changes. Prefer adding inputs over creating near-duplicate variants.
- Update examples when behavior or inputs change.

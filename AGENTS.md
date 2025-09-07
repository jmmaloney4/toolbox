## Making a workflow reusable with `workflow_call`

This guide shows how to convert an existing workflow into a callable (reusable) workflow that other repositories can invoke via `uses:`.

### 1) Replace triggers with `workflow_call` and define inputs

Require explicit inputs so the caller controls execution context.

```yaml
on:
  workflow_call:
    inputs:
      runs-on:
        description: 'Runner label for all jobs'
        required: true
        type: string
      repository:
        description: 'Repository to checkout and build (owner/repo)'
        required: true
        type: string
      ref:
        description: 'Git ref to checkout and build'
        required: true
        type: string
```

Remove other triggers like `push`, `pull_request`, `workflow_dispatch` if you want callable-only.

### 2) Use the input runner on all jobs

```yaml
jobs:
  example:
    runs-on: ${{ inputs.runs-on }}
```

### 3) Ensure you operate on the caller's repo/ref

Every job that needs the source must checkout the caller's repository and ref:

```yaml
- uses: actions/checkout@v4
  with:
    repository: ${{ inputs.repository }}
    ref: ${{ inputs.ref }}
```

### 4) Keep everything else the same

- Permissions and caching can remain as-is.
- Any paths (e.g., `flake.lock`) will resolve within the checked-out caller repo.

### Minimal consumer workflow (copy-paste)

In the calling repo:

```yaml
name: Nix CI (shared)

on:
  workflow_dispatch:
  pull_request:

jobs:
  nix-build:
    uses: jmmaloney4/workflows/.github/workflows/nix.yml@main
    with:
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
```

### Common pitfalls

- Variables and secrets are NOT inherited from the caller; pass what you need via inputs or use repository/organization secrets in the reusable workflow's repo.
- Always pin `uses: owner/repo/path@ref` to a stable ref (`main` or a tag).
- Ensure the runner label (`runs-on`) exists/works for the caller (e.g., `ubuntu-latest` or your self-hosted label).
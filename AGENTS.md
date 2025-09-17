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

The `runs-on` input is required and is not inherited from callers; define it as a string input and use `${{ inputs.runs-on }}` for all jobs.

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

### Common pitfalls

- Variables and secrets are NOT inherited from callers; do not rely on caller `vars` or `secrets` unless explicitly passed as inputs or available in this repo.
- Ensure your docs clearly state required inputs and expected runner labels.

### Authoring composite actions and scripts

- Prefer composite actions in `.github/actions/<action-name>` for any non-trivial logic or multi-step shell. Keep workflow `.yml` files declarative and thin.
- Place implementation scripts in dedicated files (e.g., `main.sh`, `script.py`) inside the action directory. Avoid large inline multi-line `run:` blocks.
- Follow the pattern used in `.github/actions/compute-flake-build-matrix/` (separate `action.yml` + `main.sh`).

Example action layout:

```text
.github/actions/compute-example/
├─ action.yml
└─ main.sh
```

Minimal `action.yml` for a composite action:

```yaml
name: Compute Example
runs:
  using: "composite"
  steps:
  - shell: bash
    run: $GITHUB_ACTION_PATH/main.sh
```

Minimal `main.sh` guidelines:

```bash
#!/usr/bin/env bash
set -euo pipefail
# implement logic here
```

Calling from a workflow (reusable-safe):

Do NOT use a local relative path (e.g., `./.github/actions/compute-example`) in reusable workflows. When this workflow is called from another repository, local paths may not resolve as intended. Always reference actions via repository path with a pinned ref:

```yaml
- uses: jmmaloney4/toolbox/.github/actions/compute-example@main
```

Guidelines:
- Name scripts by intent; keep them idempotent and locally runnable.
- Accept configuration via composite action `inputs` and `env`; avoid hard-coding repo-specific paths.
- Emit clear errors; prefer `set -euo pipefail` and explicit checks.
- Document inputs/outputs in `action.yml` and keep usage examples in this repo’s README.
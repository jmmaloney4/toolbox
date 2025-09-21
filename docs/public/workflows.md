# GitHub Actions Workflows

This repository provides reusable GitHub Actions workflows for common CI/CD tasks across projects.

## Available Workflows

### 🦀 `rust.yml`

- **Path**: `.github/workflows/rust.yml` (callable-only)
- **Purpose**: Run Rust CI (cargo check, test with nextest + JUnit, clippy formatting)
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to checkout (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`

#### Minimal consumer workflow (copy-paste)

```yaml
name: '🦀 rust'
on:
  workflow_dispatch:
  pull_request:
  push:
    branches:
    - main

permissions:
  contents: read
  id-token: write
  checks: write

jobs:
  rust:
    uses: jmmaloney4/toolbox/.github/workflows/rust.yml@main
    with:
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
```

### ❄️ `nix.yml`

- **Path**: `.github/workflows/nix.yml` (callable-only)
- **Purpose**: Build uncached Nix flake outputs for the calling repository
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to build (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`

#### Minimal consumer workflow (copy-paste)

```yaml
name: '❄️ nix'
on:
  workflow_dispatch:
  pull_request:
  push:
    branches:
    - main

permissions:
  contents: read
  id-token: write

jobs:
  nix-build:
    uses: jmmaloney4/toolbox/.github/workflows/nix.yml@main
    with:
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
```

### 📦 `pnpm.yml`

- **Path**: `.github/workflows/pnpm.yml` (callable-only)
- **Purpose**: Publish pnpm packages to GitHub Container Registry (GHCR) with automatic version analysis
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to checkout (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`
- **Optional inputs**:
  - **dry_run**: Run in dry-run mode (show analysis without publishing) - defaults to `false`

#### Minimal consumer workflow (copy-paste)

```yaml
name: '📦 pnpm'
on:
  workflow_dispatch:
  push:
    branches:
    - main
    tags:
    - 'v*'

permissions:
  contents: read
  packages: write

jobs:
  pnpm:
    uses: jmmaloney4/toolbox/.github/workflows/pnpm.yml@main
    with:
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
      dry_run: ${{ !startsWith(github.ref, 'refs/tags/v') }}
```

**Note**: This workflow automatically analyzes package versions and only publishes packages that have version changes. It uses the `analyze-pnpm-packages` action to determine which packages need publishing.

### ☁️ `pulumi.yml`

- **Path**: `.github/workflows/pulumi.yml` (callable-only)
- **Purpose**: Preview and deploy Pulumi stacks with PR commenting
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest`)
  - **repository**: Repository to checkout (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`
  - **google_workload_identity_provider**: GCP Workload Identity Provider resource
  - **google_service_account_email**: GCP service account email
  - **pulumi_backend_url**: GCS bucket URL for Pulumi backend (e.g., `gs://my-bucket-name`)
- **Optional inputs**:
  - **pr_number**: Pull request number for commenting (pass `0` or omit for non-PR triggers)
  - **is_fork**: Whether the PR comes from a fork (affects commenting permissions)

#### Minimal consumer workflow (copy-paste)

```yaml
name: ☁️ pulumi

on:
  push:
    branches:
    - main
    tags:
    - 'v*'
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  packages: read
  actions: write
  deployments: write
  id-token: write
  issues: write
  pull-requests: write

jobs:
  pulumi:
    uses: jmmaloney4/toolbox/.github/workflows/pulumi.yml@main
    with:
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
      google_workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
      google_service_account_email: ${{ vars.GCP_SERVICE_ACCOUNT_EMAIL }}
      pulumi_backend_url: gs://${{ vars.PULUMI_BACKEND_BUCKET }}

      # PR context (enables commenting on PRs)
      pr_number: ${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && github.event.pull_request.number || 0 }}
      is_fork: ${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && github.event.pull_request.head.repo.fork }}
```

**Note**: Ensure each Pulumi stack defines `gcp:project` in its stack configuration to specify the target GCP project.

### 🤖 `claude.yml`

- **Path**: `.github/workflows/claude.yml` (callable-only)
- **Purpose**: Automated Claude AI assistant for GitHub issues and comments
- **Important**: Put all event-based `if:` conditions in the caller workflow. The reusable workflow runs under `workflow_call` and does not have access to original event payloads.
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to checkout (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`

#### Minimal consumer workflow (copy-paste)

```yaml
name: 🤖 claude

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

permissions:
  contents: read
  pull-requests: read
  issues: read
  id-token: write
  actions: read

jobs:
  claude:
    # Gate on event context in the caller
    if: |
      (github.event_name == 'issue_comment' &&
       (contains(github.event.comment.body, '@claude') || contains(github.event.comment.body, '@Claude') || contains(github.event.comment.body, '@CLAUDE')) &&
       !(contains(github.event.comment.body, 'claude review') || contains(github.event.comment.body, 'Claude review') || contains(github.event.comment.body, 'CLAUDE REVIEW'))) ||
      (github.event_name == 'pull_request_review_comment' &&
       (contains(github.event.comment.body, '@claude') || contains(github.event.comment.body, '@Claude') || contains(github.event.comment.body, '@CLAUDE')) &&
       !(contains(github.event.comment.body, 'claude review') || contains(github.event.comment.body, 'Claude review') || contains(github.event.comment.body, 'CLAUDE REVIEW'))) ||
      (github.event_name == 'pull_request_review' &&
       (contains(github.event.review.body, '@claude') || contains(github.event.review.body, '@Claude') || contains(github.event.review.body, '@CLAUDE')) &&
       !(contains(github.event.review.body, 'claude review') || contains(github.event.review.body, 'Claude review') || contains(github.event.review.body, 'CLAUDE REVIEW'))) ||
      (github.event_name == 'issues' &&
       ((contains(github.event.issue.body, '@claude') || contains(github.event.issue.body, '@Claude') || contains(github.event.issue.body, '@CLAUDE')) ||
        (contains(github.event.issue.title, '@claude') || contains(github.event.issue.title, '@Claude') || contains(github.event.issue.title, '@CLAUDE'))) &&
       !((contains(github.event.issue.body, 'claude review') || contains(github.event.issue.body, 'Claude review') || contains(github.event.issue.body, 'CLAUDE REVIEW')) ||
         (contains(github.event.issue.title, 'claude review') || contains(github.event.issue.title, 'Claude review') || contains(github.event.issue.title, 'CLAUDE REVIEW'))))
    uses: jmmaloney4/toolbox/.github/workflows/claude.yml@main
    with:
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

### 👀 `claude-review.yml`

- **Path**: `.github/workflows/claude-review.yml` (callable-only)
- **Purpose**: Automated Claude AI code review triggered by "claude review" comments
- **Important**: Gate on event context in the caller workflow. The reusable workflow runs under `workflow_call` and cannot read `github.event.comment.*`.
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to checkout (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`
- **Required secrets**:
  - **CLAUDE_CODE_OAUTH_TOKEN**: Claude Code OAuth token for authentication

#### Minimal consumer workflow (copy-paste)

```yaml
name: 👀 claude review

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: read
  issues: read
  id-token: write
  actions: read

jobs:
  claude-review:
    # Only run when someone comments "claude review" on a pull request
    if: |
      (github.event_name == 'issue_comment' &&
       github.event.issue.pull_request &&
       (contains(github.event.comment.body, 'claude review') || contains(github.event.comment.body, 'Claude review') || contains(github.event.comment.body, 'CLAUDE REVIEW')) &&
       !contains(github.event.comment.body, 'no claude review') &&
       !contains(github.event.comment.body, 'disable claude review') &&
       !contains(github.event.comment.body, 'claude review is not needed')) ||
      (github.event_name == 'pull_request_review_comment' &&
       (contains(github.event.comment.body, 'claude review') || contains(github.event.comment.body, 'Claude review') || contains(github.event.comment.body, 'CLAUDE REVIEW')) &&
       !contains(github.event.comment.body, 'no claude review') &&
       !contains(github.event.comment.body, 'disable claude review') &&
       !contains(github.event.comment.body, 'claude review is not needed'))

    uses: jmmaloney4/toolbox/.github/workflows/claude-review.yml@main
    with:
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

## Usage Notes

- All workflows are designed to be called from other repositories using the `uses:` syntax
- Required inputs must be provided by the calling workflow
- Workflows automatically checkout the specified repository and ref
- For production use, consider pinning to specific releases instead of `@main`

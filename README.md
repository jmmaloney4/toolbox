# 🔧 toolbox

Reusable GitHub Actions workflows, composite actions, and development environments for CI/CD across repositories.

## 📦 `@jmmaloney4/pulumi-components`

- **Path**: `packages/toolbox`
- **Purpose**: Reusable Pulumi components for infrastructure management
- **Installation**:
  ```bash
  pnpm add "git+https://github.com/jmmaloney4/toolbox.git#path:/packages/toolbox"
  ```

### Available Components

#### GitHubOidcResource

Sets up GitHub Actions OIDC authentication with GCP, creating necessary service accounts and workload identity configuration.

```typescript
import { GitHubOidcResource } from "@jmmaloney4/pulumi-components/pulumi";

const githubOidc = new GitHubOidcResource("github-oidc", {
    repoOwner: "jmmaloney4",
    repoName: "my-repo",
    serviceAccountRoles: ["roles/storage.admin"],
    limitToRef: "refs/heads/main"  // Optional
});
```

See the [package documentation](packages/toolbox/README.md) for more details.

### Using `GitHubOidcResource` with `.github/workflows/pulumi.yml`

- **What it provides**: The component creates all GCP resources needed for OIDC auth used by the reusable Pulumi workflow: a Service Account, a Workload Identity Pool, a GitHub OIDC Provider, and the `roles/iam.workloadIdentityUser` binding.
- **Output → Workflow input mapping**:
  - `workloadIdentityProviderResource` → `google_workload_identity_provider`
  - `serviceAccountEmail` → `google_service_account_email`

Workflow usage in a caller repo:

```yaml
name: Infra

on:
  push:
    branches: [ main ]
  pull_request:

jobs:
  pulumi:
    uses: jmmaloney4/toolbox/.github/workflows/pulumi.yml@main
    with:
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
      google_workload_identity_provider: ${{ vars.GOOGLE_WORKLOAD_IDENTITY_PROVIDER }}
      google_service_account_email: ${{ vars.GOOGLE_SERVICE_ACCOUNT_EMAIL }}
      pulumi_backend_url: ${{ vars.PULUMI_BACKEND_URL }} # e.g., gs://my-pulumi-state
```

Notes:

- Bootstrap once with Pulumi to create the OIDC resources using the component, then copy the two outputs into repo variables (recommended) or secrets.
- If you set `limitToRef` when creating the provider, ensure it matches the refs where the workflow will run.

## 🦀 `rust.yml`

- **Path**: `.github/workflows/rust.yml` (callable-only)
- **Purpose**: Run Rust CI (cargo check, test with nextest + JUnit, clippy formatting)
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to checkout (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`

### Minimal consumer workflow (copy-paste)

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
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
```

## ❄️ `nix.yml`

- **Path**: `.github/workflows/nix.yml` (callable-only)
- **Purpose**: Build uncached Nix flake outputs for the calling repository
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to build (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`

### Minimal consumer workflow (copy-paste)

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
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
```

## ☁️ `pulumi.yml`

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

### Minimal consumer workflow (copy-paste)

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
  actions: write
  deployments: write
  id-token: write
  issues: write
  pull-requests: write

jobs:
  pulumi:
    uses: jmmaloney4/toolbox/.github/workflows/pulumi.yml@main
    with:
      runs-on: ubuntu-latest
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

## 🤖 `claude.yml`

- **Path**: `.github/workflows/claude.yml` (callable-only)
- **Purpose**: Automated Claude AI assistant for GitHub issues and comments
- **Important**: Put all event-based `if:` conditions in the caller workflow. The reusable workflow runs under `workflow_call` and does not have access to original event payloads.
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to checkout (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`

### Minimal consumer workflow (copy-paste)

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
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

## 👀 `claude-review.yml`

- **Path**: `.github/workflows/claude-review.yml` (callable-only)
- **Purpose**: Automated Claude AI code review triggered by "claude review" comments
- **Important**: Gate on event context in the caller workflow. The reusable workflow runs under `workflow_call` and cannot read `github.event.comment.*`.
- **Required inputs**:
  - **runs-on**: Runner label (e.g., `ubuntu-latest` or your self-hosted label)
  - **repository**: Repository to checkout (`owner/repo`), typically `${{ github.repository }}`
  - **ref**: Git ref to build, typically `${{ github.ref }}`
- **Required secrets**:
  - **CLAUDE_CODE_OAUTH_TOKEN**: Claude Code OAuth token for authentication

### Minimal consumer workflow (copy-paste)

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
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

## 🛠️ Development Environment

This repository includes a Nix flake that provides a consistent development environment across all supported platforms. The environment includes common development tools, language runtimes, and cloud utilities.

### Prerequisites

1. Install Nix package manager:
   ```bash
   curl -L https://nixos.org/nix/install | sh
   ```

2. Enable flakes (if not already enabled):
   ```bash
   mkdir -p ~/.config/nix
   echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
   ```

3. Install direnv (optional, but recommended):
   ```bash
   nix-env -i direnv
   ```

### Usage

#### Using direnv (recommended)

1. Allow direnv in the repository:
   ```bash
   cd nix/default
   direnv allow
   ```

2. The development environment will be automatically activated when you enter the directory.

#### Manual activation

1. Enter a development shell:
   ```bash
   cd nix/default
   nix develop
   ```

### Available Tools

The development environment includes:

- **Build Tools**: Make, CMake, Ninja, pkg-config
- **Version Control**: Git, GitHub CLI
- **Development Tools**: direnv, Nix LSP
- **Languages**: Rust (with rust-analyzer), Go, Python 3, Node.js
- **Cloud Tools**: AWS CLI, Azure CLI, Google Cloud SDK, kubectl, Helm
- **Utilities**: jq, yq, ripgrep, fd, bat, exa, fzf, htop, tmux

### Customization

To customize the development environment, modify `nix/default/flake.nix`. The file is well-documented and follows Nix best practices.
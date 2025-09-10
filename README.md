workflows

Reusable GitHub Actions workflows and composite actions for CI/CD across repositories.

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
  - **google_project**: GCP project ID
  - **google_workload_identity_provider**: GCP Workload Identity Provider resource
  - **google_service_account_email**: GCP service account email
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
      google_project: ${{ vars.GCP_PROJECT_ID }}
      google_workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
      google_service_account_email: ${{ vars.GCP_SERVICE_ACCOUNT_EMAIL }}

      # PR context (enables commenting on PRs)
      pr_number: ${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && github.event.pull_request.number || 0 }}
      is_fork: ${{ (github.event_name == 'pull_request' || github.event_name == 'pull_request_target') && github.event.pull_request.head.repo.fork }}
```

## 🤖 `claude.yml`

- **Path**: `.github/workflows/claude.yml` (callable-only)
- **Purpose**: Automated Claude AI assistant for GitHub issues and comments
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
    uses: jmmaloney4/toolbox/.github/workflows/claude.yml@main
    with:
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```


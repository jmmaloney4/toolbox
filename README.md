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


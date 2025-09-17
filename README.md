# 🔧 toolbox

Reusable GitHub Actions workflows, composite actions, and development environments for CI/CD across repositories.

## 📚 Documentation

- **[GitHub Actions Workflows](docs/public/workflows.md)** - Reusable workflows for Rust, Nix, Pulumi, and Claude AI
- **[Pulumi Components](docs/public/pulumi.md)** - `@jmmaloney4/toolbox` package with reusable Pulumi components
- **[Renovate Presets](docs/public/renovate.md)** - Composable Renovate configurations for dependency management

## 🚀 Quick Start

### GitHub Actions Workflows

Use our reusable workflows in your repository:

```yaml
# Rust CI
jobs:
  rust:
    uses: jmmaloney4/toolbox/.github/workflows/rust.yml@main
    with:
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}

# Nix builds
jobs:
  nix-build:
    uses: jmmaloney4/toolbox/.github/workflows/nix.yml@main
    with:
      runs-on: ubuntu-latest
      repository: ${{ github.repository }}
      ref: ${{ github.ref }}
```

### Pulumi Components

Install the Pulumi package:

```bash
pnpm add "git+https://github.com/jmmaloney4/toolbox.git#path:/packages/toolbox"
```

Use the GitHubOidcResource component:

```typescript
import { GitHubOidcResource } from "@jmmaloney4/toolbox/pulumi";

const githubOidc = new GitHubOidcResource("github-oidc", {
    repoOwner: "jmmaloney4",
    repoName: "my-repo",
    serviceAccountRoles: ["roles/storage.admin"],
    limitToRef: "refs/heads/main"
});
```

### Renovate Presets

Configure Renovate with our presets:

```json
{
  "extends": [
    "github>jmmaloney4/toolbox//renovate/all.json"
  ]
}
```

## 🛠️ Development Environment

This repository includes a Nix flake that provides a consistent development environment across all supported platforms.

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
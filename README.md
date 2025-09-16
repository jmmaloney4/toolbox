# 🔧 toolbox

Reusable GitHub Actions workflows, composite actions, and development environments for CI/CD across repositories.

## 📦 `@jmmaloney4/pulumi-components`

- **Path**: `packages/pulumi-components`
- **Purpose**: Reusable Pulumi components for infrastructure management
- **Installation**:
  ```bash
  pnpm add "git+https://github.com/jmmaloney4/toolbox.git#path:/packages/pulumi-components"
  ```

### Available Components

#### GitHubOidcResource

Sets up GitHub Actions OIDC authentication with GCP, creating necessary service accounts and workload identity configuration.

```typescript
import { GitHubOidcResource } from "@jmmaloney4/pulumi-components";

const githubOidc = new GitHubOidcResource("github-oidc", {
    repoOwner: "jmmaloney4",
    repoName: "my-repo",
    serviceAccountRoles: ["roles/storage.admin"],
    limitToRef: "refs/heads/main"  // Optional
});
```

See the [package documentation](packages/pulumi-components/README.md) for more details.

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

[Rest of the existing README content...]
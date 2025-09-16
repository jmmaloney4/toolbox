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

## 🦀 `rust.yml`

[Rest of the existing README content...]
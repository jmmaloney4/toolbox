# @jmmaloney4/pulumi-components

Reusable Pulumi components for infrastructure management.

## Installation

You can install this package directly from GitHub using pnpm:

```bash
pnpm add "git+https://github.com/jmmaloney4/toolbox.git#path:/packages/pulumi-components"
```

Or pin to a specific version/commit:

```bash
pnpm add "git+https://github.com/jmmaloney4/toolbox.git#path:/packages/pulumi-components#v0.1.0"
```

## Components

### GitHubOidcResource

A component that sets up GitHub Actions OIDC authentication with Google Cloud Platform (GCP). This creates:

- A GCP Service Account
- A Workload Identity Pool
- A Workload Identity Provider configured for GitHub Actions
- Necessary IAM bindings

#### Usage

```typescript
import * as pulumi from "@pulumi/pulumi";
import { GitHubOidcResource } from "@jmmaloney4/pulumi-components";

const githubOidc = new GitHubOidcResource("github-oidc", {
    repoOwner: "jmmaloney4",
    repoName: "my-repo",
    serviceAccountRoles: [
        "roles/storage.admin",
        "roles/secretmanager.secretAccessor"
    ],
    limitToRef: "refs/heads/main"  // Optional: limit to specific branch/tag
});

// Export the service account email and workload identity provider resource
export const serviceAccountEmail = githubOidc.serviceAccountEmail;
export const workloadIdentityProviderResource = githubOidc.workloadIdentityProviderResource;
```

#### Configuration

Create a stack configuration file (e.g., `Pulumi.dev.yaml`):

```yaml
config:
  gcp:project: your-project-id
  wif:
    repoOwner: jmmaloney4
    repoName: my-repo
    serviceAccountRoles:
      - roles/storage.admin
      - roles/secretmanager.secretAccessor
    limitToRef: refs/heads/main
```

## Development

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Build the package:
   ```bash
   pnpm run build
   ```

### Running Examples

The `examples/stack` directory contains a working example of how to use this package:

1. Navigate to the example:
   ```bash
   cd examples/stack
   ```
2. Initialize a new stack:
   ```bash
   pulumi stack init dev
   ```
3. Configure the stack:
   ```bash
   pulumi config set gcp:project your-project-id
   pulumi config set --path wif.repoOwner jmmaloney4
   pulumi config set --path wif.repoName my-repo
   pulumi config set --path 'wif.serviceAccountRoles[0]' roles/storage.admin
   ```
4. Deploy:
   ```bash
   pulumi up
   ```

## License

MPL-2.0

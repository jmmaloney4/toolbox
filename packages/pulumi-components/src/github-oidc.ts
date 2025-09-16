import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

export interface GitHubOidcArgs {
    repoOwner: string;
    repoName: string;
    serviceAccountRoles: string[];
    limitToRef?: string;
}

export class GitHubOidcResource extends pulumi.ComponentResource {
    public readonly serviceAccountEmail: pulumi.Output<string>;
    public readonly workloadIdentityProviderResource: pulumi.Output<string>;

    constructor(name: string, args: GitHubOidcArgs, opts?: pulumi.ComponentResourceOptions) {
        super("custom:github:oidc", name, args, opts);

        // Create a service account for GitHub Actions
        const serviceAccount = new gcp.serviceaccount.Account(`${name}-sa`, {
            accountId: pulumi.getStack(),
            displayName: `GitHub Actions (${pulumi.getStack()})`,
        }, { parent: this });

        // Assign roles to the service account
        args.serviceAccountRoles.forEach((role, idx) => {
            new gcp.projects.IAMMember(`${name}-sa-role-${idx}`, {
                role: role,
                member: pulumi.interpolate\`serviceAccount:\${serviceAccount.email}\`,
            }, { parent: this });
        });

        // Create a Workload Identity Pool for GitHub
        const pool = new gcp.iam.WorkloadIdentityPool(`${name}-pool`, {
            workloadIdentityPoolId: \`github-${pulumi.getStack()}\`,
            displayName: "GitHub Actions",
            description: "Identity pool for GitHub Actions",
        }, { parent: this });

        // Create a Workload Identity Provider for GitHub Actions
        const provider = new gcp.iam.WorkloadIdentityPoolProvider(`${name}-provider`, {
            workloadIdentityPoolId: pool.workloadIdentityPoolId,
            workloadIdentityPoolProviderId: \`github-${pulumi.getStack()}\`,
            displayName: "GitHub Actions provider",
            description: "GitHub Actions provider",
            attributeMapping: {
                "google.subject": "assertion.sub",
                "attribute.repository": "assertion.repository",
                "attribute.repository_owner": "assertion.repository_owner",
                "attribute.ref": "assertion.ref",
            },
            oidc: {
                issuerUri: "https://token.actions.githubusercontent.com",
                allowedAudiences: ["https://github.com/${args.repoOwner}"],
            },
            attributeCondition: args.limitToRef
                ? \`attribute.repository=="$\{args.repoOwner}/$\{args.repoName}" && attribute.ref=="$\{args.limitToRef}"\`
                : \`attribute.repository=="$\{args.repoOwner}/$\{args.repoName}"\`,
        }, { parent: this });

        // Allow authentications from the Workload Identity Provider to impersonate the Service Account
        new gcp.serviceaccount.IAMBinding(`${name}-sa-binding`, {
            serviceAccountId: serviceAccount.name,
            role: "roles/iam.workloadIdentityUser",
            members: [
                pulumi.interpolate\`principalSet://iam.googleapis.com/\${pool.name}/attribute.repository/$\{args.repoOwner}/$\{args.repoName}\`,
            ],
        }, { parent: this });

        // Export the service account email and workload identity provider resource
        this.serviceAccountEmail = serviceAccount.email;
        this.workloadIdentityProviderResource = pulumi.interpolate\`\${provider.name}\`;

        this.registerOutputs({
            serviceAccountEmail: this.serviceAccountEmail,
            workloadIdentityProviderResource: this.workloadIdentityProviderResource,
        });
    }
}

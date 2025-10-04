import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import type { WorkloadIdentityPoolResource } from "./workload-identity-pool";

/**
 * Generates a service account ID with length constraints.
 *
 * Format: sa-{owner}-{repo}-{stack}
 * - Total length: exactly 32 characters
 * - Stack name: 5 characters maximum
 * - Owner name: 15 characters maximum
 * - Repo name: 10 characters maximum
 *
 * @param repoOwner - GitHub repository owner
 * @param repoName - GitHub repository name
 * @param stackName - Pulumi stack name
 * @returns Service account ID (32 characters max)
 * @throws Error if stack name exceeds 5 characters
 */
function generateServiceAccountId(
	repoOwner: string,
	repoName: string,
	stackName: string,
): string {
	// Validate stack name length
	if (stackName.length > 5) {
		throw new Error(
			`Stack name "${stackName}" exceeds 5 character limit for account ID generation`,
		);
	}

	// Format: sa-{owner}-{repo}-{stack}
	// Allocate fixed lengths: 15 for owner, 10 for repo, 5 for stack (max)
	const ownerLength = 15;
	const repoLength = 10;

	// Truncate names to allocated lengths
	const truncatedOwner = repoOwner.substring(0, ownerLength);
	const truncatedRepo = repoName.substring(0, repoLength);

	// Generate account ID: "sa-" + owner(15) + "-" + repo(10) + "-" + stack(5) = 32 chars
	return `sa-${truncatedOwner}-${truncatedRepo}-${stackName}`;
}

/**
 * Generates a workload identity pool provider ID with length constraints.
 *
 * Format: provider-{owner}-{repo}-{stack}
 * - Total length: exactly 32 characters
 * - Stack name: 5 characters maximum
 * - Owner name: 12 characters maximum
 * - Repo name: 8 characters maximum
 *
 * @param repoOwner - GitHub repository owner
 * @param repoName - GitHub repository name
 * @param stackName - Pulumi stack name
 * @returns Provider ID (32 characters max)
 * @throws Error if stack name exceeds 5 characters
 */
function generateProviderId(
	repoOwner: string,
	repoName: string,
	stackName: string,
): string {
	// Validate stack name length
	if (stackName.length > 5) {
		throw new Error(
			`Stack name "${stackName}" exceeds 5 character limit for provider ID generation`,
		);
	}

	// Format: provider-{owner}-{repo}-{stack}
	// Allocate fixed lengths: 12 for owner, 8 for repo, 5 for stack (max)
	// "provider-" = 9 chars, so 32 - 9 - 2 dashes - 5 stack = 16 chars for owner+repo
	const ownerLength = 12;
	const repoLength = 8;

	// Truncate names to allocated lengths
	const truncatedOwner = repoOwner.substring(0, ownerLength);
	const truncatedRepo = repoName.substring(0, repoLength);

	// Generate provider ID: "provider-" + owner(12) + "-" + repo(8) + "-" + stack(5) = 32 chars
	return `provider-${truncatedOwner}-${truncatedRepo}-${stackName}`;
}

/**
 * Arguments for configuring a GitHub Actions Workload Identity Provider and service account.
 *
 * @remarks
 * This component creates a Service Account and binds the specified IAM roles
 * across one or more GCP projects. It also creates an OIDC provider in the
 * provided Workload Identity Pool constrained to the GitHub repository (and
 * optional ref) you specify.
 */
export interface GithubActionsWorkloadIdentityProviderArgs {
	repoOwner: string;
	repoName: string;
	// Map each role to a list of project IDs to bind the role in
	// Example: { "roles/storage.admin": ["my-prod","my-stage"], "roles/viewer": ["my-dev"] }
	serviceAccountRoles: Record<string, string[]>;
	limitToRef?: string;
	/** Existing Workload Identity Pool to attach provider to */
	pool: WorkloadIdentityPoolResource;
}

/**
 * Creates a GCP Workload Identity Provider for GitHub Actions and a Service Account
 * with the provided role bindings.
 *
 * Audience configuration:
 * - The provider's `oidc.allowedAudiences` includes the fully-qualified provider resource
 *   URL (e.g., `https://iam.googleapis.com/projects/<proj>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`).
 *   When using `google-github-actions/auth@v2`, GitHub issues an ID token whose `aud` defaults
 *   to this provider resource. Google requires that the token's audience match one of the
 *   provider's allowed audiences, so this value must be present.
 * - We also allow `https://github.com/<owner>` for compatibility with workflows that explicitly
 *   request that audience (older guidance). If all callers use the default provider-resource
 *   audience, this GitHub-owner audience can be removed to tighten scope.
 *
 * Outputs:
 * - `serviceAccountEmail` — email of the created Service Account
 * - `workloadIdentityProviderResource` — full resource name of the provider
 */
export class GithubActionsWorkloadIdentityProvider extends pulumi.ComponentResource {
	public readonly serviceAccountEmail: pulumi.Output<string>;
	public readonly workloadIdentityProviderResource: pulumi.Output<string>;

	constructor(
		name: string,
		args: GithubActionsWorkloadIdentityProviderArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("custom:github:actionsWorkloadIdentityProvider", name, args, opts);

		// Create a service account for GitHub Actions
		const serviceAccount = new gcp.serviceaccount.Account(
			`${name}-sa`,
			{
				accountId: generateServiceAccountId(
					args.repoOwner,
					args.repoName,
					pulumi.getStack(),
				),
				displayName: `GitHub Actions (${pulumi.getStack()})`,
			},
			{ parent: this },
		);

		// Assign roles to the service account across projects
		const sortedRoles = Object.keys(args.serviceAccountRoles ?? {}).sort();
		let idx = 0;
		for (const role of sortedRoles) {
			const projects = Array.from(
				new Set((args.serviceAccountRoles[role] ?? []).slice().sort()),
			);
			for (const project of projects) {
				new gcp.projects.IAMMember(
					`${name}-sa-role-${idx++}`,
					{
						project,
						role,
						member: serviceAccount.email.apply(
							(e: string) => `serviceAccount:${e}`,
						),
					},
					{ parent: this },
				);
			}
		}

		// Create a Workload Identity Provider for GitHub Actions
		const providerId = generateProviderId(
			args.repoOwner,
			args.repoName,
			pulumi.getStack(),
		);
		const provider = new gcp.iam.WorkloadIdentityPoolProvider(
			`${name}-provider`,
			{
				workloadIdentityPoolId: args.pool.workloadIdentityPoolId,
				workloadIdentityPoolProviderId: providerId,
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
					allowedAudiences: [
						pulumi.interpolate`https://iam.googleapis.com/${args.pool.name}/providers/${providerId}`,
						`https://github.com/${args.repoOwner}`,
					],
				},
				attributeCondition: args.limitToRef
					? pulumi.interpolate`attribute.repository=="${args.repoOwner}/${args.repoName}" && attribute.ref=="${args.limitToRef}"`
					: pulumi.interpolate`attribute.repository=="${args.repoOwner}/${args.repoName}"`,
			},
			{ parent: this },
		);

		// Allow authentications from the Workload Identity Provider to impersonate the Service Account
		new gcp.serviceaccount.IAMBinding(
			`${name}-sa-binding`,
			{
				serviceAccountId: serviceAccount.name,
				role: "roles/iam.workloadIdentityUser",
				members: [
					pulumi.interpolate`principalSet://iam.googleapis.com/${args.pool.name}/attribute.repository/${args.repoOwner}/${args.repoName}`,
				],
			},
			{ parent: this },
		);

		// Export the service account email and workload identity provider resource
		this.serviceAccountEmail = serviceAccount.email;
		this.workloadIdentityProviderResource = pulumi.interpolate`${provider.name}`;

		this.registerOutputs({
			serviceAccountEmail: this.serviceAccountEmail,
			workloadIdentityProviderResource: this.workloadIdentityProviderResource,
		});
	}
}

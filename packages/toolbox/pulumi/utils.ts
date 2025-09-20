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
export function generateServiceAccountId(
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
export function generateProviderId(
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

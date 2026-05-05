import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * Path access configuration for a Cloudflare Zero Trust Access Application.
 */
export interface AccessPathConfig {
	/**
	 * Path pattern (e.g., "/blog/*", "/research/*").
	 * Supports wildcards.
	 */
	pattern: pulumi.Input<string>;

	/**
	 * Access level for this path.
	 * - "public": Allow everyone (visitors still complete the Cloudflare Zero Trust login flow)
	 * - "bypass": Bypass authentication entirely — no login prompt
	 * - "github-org": Require GitHub organization membership
	 */
	access: "public" | "bypass" | "github-org";
}

/**
 * Configuration for auto-creating a GitHub OAuth Identity Provider in
 * Cloudflare Zero Trust Access.
 *
 * When provided, AccessGate creates a `ZeroTrustAccessIdentityProvider`
 * resource (type `"github"`) and uses its generated ID for any paths with
 * `access: "github-org"`.  Mutually exclusive with `githubIdentityProviderId`.
 *
 * The GitHub OAuth App must be created manually in
 * GitHub Settings → Developer settings → OAuth Apps.
 * The callback URL should be `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`.
 */
export interface AccessGithubOAuthConfig {
	/**
	 * GitHub OAuth App client ID.
	 */
	clientId: pulumi.Input<string>;

	/**
	 * GitHub OAuth App client secret.
	 * This value will be stored as a Pulumi secret.
	 */
	clientSecret: pulumi.Input<string>;
}

/**
 * Arguments for creating an AccessGate component.
 *
 * AccessGate provisions Cloudflare Zero Trust Access Applications for the
 * given domain and path combinations.  It can optionally auto-create a GitHub
 * OAuth Identity Provider for paths requiring GitHub org membership.
 */
export interface AccessGateArgs {
	/**
	 * Cloudflare account ID where resources will be created.
	 */
	accountId: pulumi.Input<string>;

	/**
	 * Cloudflare zone ID for the domain.
	 */
	zoneId: pulumi.Input<string>;

	/**
	 * Logical name prefix for Access Application resources.
	 */
	name: pulumi.Input<string>;

	/**
	 * Domains to protect (e.g., ["site.example.com"]).
	 * Each domain gets Access Applications for every path in `paths`.
	 */
	domains: pulumi.Input<string>[];

	/**
	 * Path access configurations.
	 * One `ZeroTrustAccessApplication` is created per (domain, path) combination.
	 */
	paths: AccessPathConfig[];

	/**
	 * Pre-existing GitHub Identity Provider ID in Cloudflare Access.
	 * Required only when at least one path has `access: "github-org"` and
	 * `githubOAuthConfig` is not provided.
	 *
	 * Mutually exclusive with `githubOAuthConfig`.
	 */
	githubIdentityProviderId?: pulumi.Input<string>;

	/**
	 * Auto-create a GitHub OAuth Identity Provider for Cloudflare Access.
	 * When provided, a `ZeroTrustAccessIdentityProvider` resource is created
	 * and its ID is used for any paths with `access: "github-org"`.
	 *
	 * Mutually exclusive with `githubIdentityProviderId`.
	 */
	githubOAuthConfig?: AccessGithubOAuthConfig;

	/**
	 * GitHub organization name(s) for restricted path access.
	 * Required when at least one path has `access: "github-org"`.
	 */
	githubOrganizations?: pulumi.Input<string>[];

	/**
	 * Session duration for Access Applications.
	 * @default "24h"
	 */
	sessionDuration?: pulumi.Input<string>;

	/**
	 * Access Application type.
	 * @default "self_hosted"
	 */
	type?: pulumi.Input<string>;
}

/**
 * AccessGate provisions Cloudflare Zero Trust Access Applications
 * for a set of domains and path patterns.
 *
 * This component can be used standalone to protect any Cloudflare-hosted
 * origin (Workers, Tunnel-backed services, etc.) without depending on
 * the WorkerSite component.
 *
 * @example
 * Protect a tunnel-backed service with GitHub org membership:
 * ```typescript
 * import { AccessGate } from "@jmmaloney4/sector7/access";
 *
 * const gate = new AccessGate("lens-access", {
 *   accountId: "abc123",
 *   zoneId: "xyz789",
 *   name: "lens",
 *   domains: ["lens.example.com"],
 *   paths: [{ pattern: "/*", access: "github-org" }],
 *   githubOAuthConfig: {
 *     clientId: "Ov23li...",
 *     clientSecret: pulumi.secret("abc123..."),
 *   },
 *   githubOrganizations: ["my-org"],
 * });
 * ```
 */
export class AccessGate extends pulumi.ComponentResource {
	/**
	 * Zero Trust Access Applications for each (domain, path) combination.
	 */
	public readonly accessApplications: cloudflare.ZeroTrustAccessApplication[];

	/**
	 * Auto-created GitHub Identity Provider (present when `githubOAuthConfig` is provided).
	 * Undefined when using a pre-existing `githubIdentityProviderId` or when no
	 * GitHub auth is needed.
	 */
	public readonly githubIdp:
		| cloudflare.ZeroTrustAccessIdentityProvider
		| undefined;

	constructor(
		name: string,
		args: AccessGateArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("sector7:cloudflare:AccessGate", name, {}, opts);

		// Input validation
		if (!args.domains || args.domains.length === 0) {
			throw new Error("AccessGate requires at least one domain");
		}

		if (args.githubOAuthConfig && args.githubIdentityProviderId) {
			throw new Error(
				"githubOAuthConfig and githubIdentityProviderId are mutually exclusive",
			);
		}

		const githubOrgPaths = (args.paths ?? []).filter(
			(p) => p.access === "github-org",
		);
		if (githubOrgPaths.length > 0) {
			if (!args.githubIdentityProviderId && !args.githubOAuthConfig) {
				throw new Error(
					"githubIdentityProviderId or githubOAuthConfig is required when using github-org access",
				);
			}
			if (!args.githubOrganizations || args.githubOrganizations.length === 0) {
				throw new Error(
					"githubOrganizations must not be empty when using github-org access",
				);
			}
		}

		if (!args.paths || args.paths.length === 0) {
			throw new Error("AccessGate requires at least one path");
		}

		// When AccessGate is used as a child of another component (e.g. WorkerSite),
		// alias resources back to the parent to preserve existing URNs from before
		// the extraction (ADR-016). Standalone usage has no parent, so no alias needed.
		const resourceOpts: pulumi.CustomResourceOptions = {
			parent: this,
			aliases: opts?.parent ? [{ parent: opts.parent }] : undefined,
		};
		const sessionDuration = args.sessionDuration ?? "24h";
		const appType = args.type ?? "self_hosted";

		// Auto-create GitHub Identity Provider if requested
		this.githubIdp = undefined;
		let githubIdentityProviderId: pulumi.Input<string> | undefined =
			args.githubIdentityProviderId;

		if (args.githubOAuthConfig) {
			this.githubIdp = new cloudflare.ZeroTrustAccessIdentityProvider(
				`${name}-github-idp`,
				{
					accountId: args.accountId,
					name: pulumi.interpolate`${args.name} GitHub`,
					type: "github",
					config: {
						clientId: args.githubOAuthConfig.clientId,
						clientSecret: args.githubOAuthConfig.clientSecret,
					},
				},
				resourceOpts,
			);
			githubIdentityProviderId = this.githubIdp.id;
		}

		// Create Zero Trust Access Applications
		this.accessApplications = [];

		for (const domain of args.domains) {
			for (const pathConfig of args.paths) {
				// NOTE: logical names use array indices rather than domain/path
				// slugs because Pulumi requires resource names to be plain strings
				// known at plan time, while args.domains is typed as
				// pulumi.Input<string>[]. If a caller passes Output<string>
				// values, we cannot extract a string synchronously for the name.
				// Reordering is unlikely in practice since configs are static.
				const domainIdx = args.domains.indexOf(domain);
				const pathIdx = args.paths.indexOf(pathConfig);

				const policyIncludes =
					pathConfig.access === "public" || pathConfig.access === "bypass"
						? [{ everyone: {} }]
						: pulumi
								.all([
									pulumi.all(args.githubOrganizations ?? []),
									githubIdentityProviderId ?? "",
								])
								.apply(
									([orgs, idpId]: [string[], string]) =>
										orgs.map((org: string) => ({
											githubOrganization: {
												identityProviderId: idpId,
												name: org,
											},
										})) as cloudflare.types.input.ZeroTrustAccessApplicationPolicyInclude[],
								);

			const app = new cloudflare.ZeroTrustAccessApplication(
				`${name}-app-d${domainIdx}-p${pathIdx}`,
					{
						accountId: args.accountId,
						zoneId: args.zoneId,
						name: pulumi
							.all([args.name, domain, pathConfig.pattern])
							.apply(
								([n, d, p]: [string, string, string]) =>
									`${n}-${d}-${p.replace(/\//g, "-").replace(/\*/g, "all")}`,
							),
						domain: pulumi.interpolate`${domain}${pathConfig.pattern}`,
						type: appType,
						sessionDuration,
						policies: [
							{
								name: {
									bypass: "Bypass for public path",
									public: "Allow everyone",
									"github-org": "GitHub org members",
								}[pathConfig.access],
								decision: {
									bypass: "bypass",
									public: "allow",
									"github-org": "allow",
								}[pathConfig.access],
								precedence: 1,
								includes: policyIncludes,
							},
						],
					},
					resourceOpts,
				);
				this.accessApplications.push(app);
			}
		}

		this.registerOutputs({
			accessApplications: this.accessApplications,
			githubIdp: this.githubIdp,
		});
	}
}

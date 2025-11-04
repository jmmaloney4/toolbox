import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import { generateWorkerScript } from "./worker-site-script";

/**
 * Path access configuration.
 */
export interface PathConfig {
	/**
	 * Path pattern (e.g., "/blog/*", "/research/*").
	 * Supports wildcards.
	 */
	pattern: pulumi.Input<string>;

	/**
	 * Access level for this path.
	 * - "public": Allow everyone
	 * - "github-org": Require GitHub organization membership
	 */
	access: "public" | "github-org";

	/**
	 * GitHub organizations allowed to access this path.
	 * Required when access is "github-org".
	 * Members of ANY of these organizations will be granted access (OR logic).
	 * @example ["my-org-engineering", "my-org-leadership"]
	 */
	organizations?: pulumi.Input<string>[];
}

/**
 * Arguments for creating a WorkerSite component.
 *
 * @remarks
 * Features:
 * - Multiple domains via WorkerDomain (with automatic DNS)
 * - Per-path access control with granular organization requirements
 * - R2 backend with Cache API
 * - Configurable cache TTL
 * - Automatic DNS record creation
 * - Optional GitHub authentication via external IDP
 */
export interface WorkerSiteArgs {
	/**
	 * Cloudflare account ID where resources will be created.
	 */
	accountId: pulumi.Input<string>;

	/**
	 * Cloudflare zone ID for the domain (required for DNS and Access).
	 */
	zoneId: pulumi.Input<string>;

	/**
	 * Name for the Worker and related resources.
	 */
	name: pulumi.Input<string>;

	/**
	 * Domains to bind the Worker to (e.g., ["site.example.com", "www.site.example.com"]).
	 * DNS records will be automatically created for each domain unless manageDns is false.
	 */
	domains: pulumi.Input<string>[];

	/**
	 * Automatically create DNS records for domains.
	 * Creates AAAA records pointing to 100:: (Workers placeholder).
	 * @default true
	 */
	manageDns?: boolean;

	/**
	 * R2 bucket configuration.
	 */
	r2Bucket: {
		/**
		 * R2 bucket name.
		 */
		bucketName: pulumi.Input<string>;

		/**
		 * Create the R2 bucket if it doesn't exist.
		 * @default false
		 */
		create?: boolean;

		/**
		 * Optional prefix for object keys in R2.
		 * @default ""
		 */
		prefix?: pulumi.Input<string>;
	};

	/**
	 * GitHub Identity Provider ID in Cloudflare Access.
	 * Optional - only required when at least one path uses "github-org" access.
	 *
	 * Create a GitHub IDP separately using cloudflare.ZeroTrustAccessIdentityProvider
	 * and pass its ID here. The same IDP can be shared across multiple WorkerSites
	 * and even across stacks via stack references.
	 *
	 * @example
	 * ```typescript
	 * const githubIdp = new cloudflare.ZeroTrustAccessIdentityProvider("github", {
	 *   accountId: accountId,
	 *   name: "GitHub",
	 *   type: "github",
	 *   configs: [{ clientId: "...", clientSecret: "..." }],
	 * });
	 *
	 * const site = new WorkerSite("site", {
	 *   // ...
	 *   githubIdentityProviderId: githubIdp.id,
	 * });
	 * ```
	 */
	githubIdentityProviderId?: pulumi.Input<string>;

	/**
	 * Path access configurations.
	 * Each path gets its own Access Application and Policy.
	 * Paths with "github-org" access must specify their allowed organizations.
	 *
	 * @example
	 * ```typescript
	 * paths: [
	 *   { pattern: "/blog/*", access: "public" },
	 *   { pattern: "/engineering/*", access: "github-org", organizations: ["my-org-eng"] },
	 *   { pattern: "/shared/*", access: "github-org", organizations: ["my-org-eng", "my-org-leadership"] },
	 * ]
	 * ```
	 */
	paths: PathConfig[];

	/**
	 * Cache TTL in seconds for static assets.
	 * @default 31536000 (1 year)
	 */
	cacheTtlSeconds?: pulumi.Input<number>;
}

/**
 * WorkerSite component for hosting static sites on Cloudflare Workers with Zero Trust access control.
 *
 * @remarks
 * Features:
 * - R2-backed Worker serving static files with Cache API
 * - Multiple domains via WorkerDomain (automatic DNS creation)
 * - Per-path access control with granular organization requirements
 * - GitHub organization-based authentication via external IDP
 * - IDP sharing across multiple sites and stacks
 *
 * @example
 * ```typescript
 * // Create a shared GitHub IDP (can be in a separate stack)
 * const githubIdp = new cloudflare.ZeroTrustAccessIdentityProvider("github", {
 *   accountId: "abc123",
 *   name: "GitHub",
 *   type: "github",
 *   configs: [{ clientId: "...", clientSecret: "..." }],
 * });
 *
 * const site = new WorkerSite("docs-site", {
 *   accountId: "abc123",
 *   zoneId: "xyz789",
 *   name: "docs-site",
 *   domains: ["docs.example.com"],
 *   r2Bucket: { bucketName: "docs-site-assets", create: true },
 *   githubIdentityProviderId: githubIdp.id,
 *   paths: [
 *     { pattern: "/blog/*", access: "public" },
 *     { pattern: "/engineering/*", access: "github-org", organizations: ["my-org-eng"] },
 *     { pattern: "/shared/*", access: "github-org", organizations: ["my-org-eng", "my-org-leadership"] },
 *   ],
 *   cacheTtlSeconds: 86400,
 * });
 * ```
 */
export class WorkerSite extends pulumi.ComponentResource {
	/**
	 * The R2 bucket storing static assets.
	 */
	public readonly bucket: cloudflare.R2Bucket | undefined;

	/**
	 * The Worker script serving static files.
	 */
	public readonly worker: cloudflare.WorkerScript;

	/**
	 * Worker domains binding the Worker to custom domains.
	 */
	public readonly workerDomains: cloudflare.WorkerDomain[];

	/**
	 * DNS records for the domains.
	 */
	public readonly dnsRecords: cloudflare.Record[];

	/**
	 * Access Applications for each path.
	 */
	public readonly accessApplications: cloudflare.AccessApplication[];

	/**
	 * Access Policies for each path.
	 */
	public readonly accessPolicies: cloudflare.AccessPolicy[];

	/**
	 * The domains bound to the Worker.
	 */
	public readonly boundDomains: pulumi.Output<string[]>;

	/**
	 * The Worker name.
	 */
	public readonly workerName: pulumi.Output<string>;

	constructor(
		name: string,
		args: WorkerSiteArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("sector7:cloudflare:WorkerSite", name, {}, opts);

		// Input validation
		if (!args.domains || args.domains.length === 0) {
			throw new Error("WorkerSite requires at least one domain");
		}

		if (!args.paths || args.paths.length === 0) {
			throw new Error("WorkerSite requires at least one path configuration");
		}

		// Validate GitHub authentication requirements
		const pathsNeedingAuth = args.paths.filter((p) => p.access === "github-org");

		if (pathsNeedingAuth.length > 0) {
			// Ensure IDP is provided
			if (!args.githubIdentityProviderId) {
				throw new Error(
					"githubIdentityProviderId is required when at least one path uses 'github-org' access. " +
					"Create a GitHub IDP using cloudflare.ZeroTrustAccessIdentityProvider and pass its ID.",
				);
			}

			// Ensure each path with github-org access has organizations specified
			for (const pathConfig of pathsNeedingAuth) {
				const pattern = pulumi.output(pathConfig.pattern);
				const orgs = pathConfig.organizations;

				if (!orgs) {
					throw new Error(
						`Path "${pattern}" has access "github-org" but no organizations specified. ` +
						`Add organizations: ["org1", "org2"] to the path configuration.`,
					);
				}

				// Check if organizations array is empty (if it's a concrete value)
				if (Array.isArray(orgs) && orgs.length === 0) {
					throw new Error(
						`Path "${pattern}" has access "github-org" but organizations array is empty. ` +
						`Specify at least one organization.`,
					);
				}
			}
		}

		const resourceOpts = { parent: this };

		// Convert githubIdentityProviderId to Output if provided
		const githubIdpId = args.githubIdentityProviderId
			? pulumi.output(args.githubIdentityProviderId)
			: undefined;

		// 1. Create or reference R2 bucket
		if (args.r2Bucket.create === true) {
			this.bucket = new cloudflare.R2Bucket(
				`${name}-bucket`,
				{
					accountId: args.accountId,
					name: args.r2Bucket.bucketName,
				},
				resourceOpts,
			);
		}

		const bucketName = this.bucket
			? this.bucket.name
			: pulumi.output(args.r2Bucket.bucketName);

		// 2. Create Worker script with Cache API support
		const bucketBinding = "R2_BUCKET";
		const cacheTtl = args.cacheTtlSeconds ?? 31536000; // Default 1 year
		const prefix = args.r2Bucket.prefix
			? pulumi.output(args.r2Bucket.prefix)
			: undefined;
		const scriptContent = prefix
			? prefix.apply((p) => generateWorkerScript(bucketBinding, p))
			: generateWorkerScript(bucketBinding);

		this.worker = new cloudflare.WorkerScript(
			`${name}-worker`,
			{
				accountId: args.accountId,
				name: args.name,
				content: scriptContent,
				r2BucketBindings: [
					{
						name: bucketBinding,
						bucketName: bucketName,
					},
				],
				plainTextBindings: [
					{
						name: "CACHE_TTL_SECONDS",
						text: pulumi.output(cacheTtl).apply((ttl) => ttl.toString()),
					},
				],
			},
			resourceOpts,
		);

		// 3. Create Worker domains and DNS records for each domain
		this.workerDomains = [];
		this.dnsRecords = [];

		// Default manageDns to true if not specified
		const shouldManageDns = args.manageDns !== false;

		// Create resources declaratively (not inside apply()) so Pulumi tracks them
		for (let i = 0; i < args.domains.length; i++) {
			const domain = args.domains[i];

			let dnsRecord: cloudflare.Record | undefined;

			// Create DNS record if manageDns is enabled (default: true)
			if (shouldManageDns) {
				dnsRecord = new cloudflare.Record(
					`${name}-dns-${i}`,
					{
						zoneId: args.zoneId,
						name: domain,
						type: "AAAA",
						value: "100::", // Workers placeholder IPv6
						proxied: true, // Enable Cloudflare proxy
					},
					resourceOpts,
				);
				this.dnsRecords.push(dnsRecord);
			}

			// Create Worker domain binding
			const workerDomainOpts = dnsRecord
				? { ...resourceOpts, dependsOn: [dnsRecord] }
				: resourceOpts;

			const workerDomain = new cloudflare.WorkerDomain(
				`${name}-domain-${i}`,
				{
					accountId: args.accountId,
					hostname: domain,
					service: this.worker.name,
					zoneId: args.zoneId,
				},
				workerDomainOpts,
			);
			this.workerDomains.push(workerDomain);
		}

		// 4. Create Access Applications and Policies for each (domain, path) combination
		this.accessApplications = [];
		this.accessPolicies = [];

		let policyPrecedence = 1;
		for (let domainIdx = 0; domainIdx < args.domains.length; domainIdx++) {
			const domain = args.domains[domainIdx];

			for (let pathIdx = 0; pathIdx < args.paths.length; pathIdx++) {
				const pathConfig = args.paths[pathIdx];

				// Create Access Application
				const app = new cloudflare.AccessApplication(
					`${name}-app-d${domainIdx}-p${pathIdx}`,
					{
						zoneId: args.zoneId,
						name: pulumi
							.all([args.name, domain, pathConfig.pattern])
							.apply(
								([n, d, p]) =>
									`${n}-${d}-${p.replace(/\//g, "-").replace(/\*/g, "all")}`,
							),
						domain: pulumi.interpolate`${domain}${pathConfig.pattern}`,
						type: "self_hosted",
						sessionDuration: "24h",
					},
					resourceOpts,
				);
				this.accessApplications.push(app);

				// Create Access Policy based on access type
				const policyIncludes =
					pathConfig.access === "public"
						? [{ everyone: true }]
						: pulumi
								.all([
									pulumi.all(pathConfig.organizations!), // Safe: validated above
									githubIdpId!, // Safe: validated above when pathsNeedingAuth.length > 0
								])
								.apply(
									([orgs, idpId]) =>
										orgs.map((org) => ({
											github: {
												identityProviderId: idpId,
												name: org,
											},
										})) as cloudflare.types.input.AccessPolicyInclude[],
								);

				const policy = new cloudflare.AccessPolicy(
					`${name}-policy-d${domainIdx}-p${pathIdx}`,
					{
						applicationId: app.id,
						zoneId: args.zoneId,
						name:
							pathConfig.access === "public"
								? "Allow everyone"
								: "GitHub org members",
						decision: "allow",
						precedence: policyPrecedence++,
						includes: policyIncludes,
					},
					resourceOpts,
				);
				this.accessPolicies.push(policy);
			}
		}

		// Outputs
		this.boundDomains = pulumi.output(args.domains);
		this.workerName = this.worker.name;

		this.registerOutputs({
			bucket: this.bucket,
			worker: this.worker,
			workerDomains: this.workerDomains,
			dnsRecords: this.dnsRecords,
			accessApplications: this.accessApplications,
			accessPolicies: this.accessPolicies,
			boundDomains: this.boundDomains,
			workerName: this.workerName,
		});
	}
}

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
}

/**
 * Arguments for creating a WorkerSite component (Phase 2).
 *
 * @remarks
 * Phase 2 features:
 * - Multiple domains via WorkerDomain (with automatic DNS)
 * - Flexible path-level access control (any number of paths)
 * - R2 backend with Cache API
 * - Configurable cache TTL
 * - Automatic DNS record creation
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
	 * This must already exist in your Cloudflare account.
	 */
	githubIdentityProviderId: pulumi.Input<string>;

	/**
	 * GitHub organization name(s) for restricted path access.
	 * Members of these organizations will be allowed to access paths with access: "github-org".
	 */
	githubOrganizations: pulumi.Input<string>[];

	/**
	 * Path access configurations.
	 * Each path gets its own Access Application and Policy.
	 *
	 * @example
	 * ```typescript
	 * paths: [
	 *   { pattern: "/blog/*", access: "public" },
	 *   { pattern: "/research/*", access: "github-org" },
	 *   { pattern: "/admin/*", access: "github-org" },
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
 * Phase 2 implementation with:
 * - R2-backed Worker serving static files with Cache API
 * - Multiple domains via WorkerDomain (automatic DNS creation)
 * - Flexible path-level access control
 * - GitHub organization-based authentication
 *
 * @example
 * ```typescript
 * const site = new WorkerSite("docs-site", {
 *   accountId: "abc123",
 *   zoneId: "xyz789",
 *   name: "docs-site",
 *   domains: ["docs.example.com", "www.docs.example.com"],
 *   r2Bucket: {
 *     bucketName: "docs-site-assets",
 *     create: true,
 *   },
 *   githubIdentityProviderId: "github-idp-id",
 *   githubOrganizations: ["my-org"],
 *   paths: [
 *     { pattern: "/blog/*", access: "public" },
 *     { pattern: "/research/*", access: "github-org" },
 *   ],
 *   cacheTtlSeconds: 86400, // 1 day
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
	public readonly worker: cloudflare.WorkersScript;

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
	public readonly accessApplications: cloudflare.ZeroTrustAccessApplication[];

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

		const githubOrgPaths = args.paths.filter((p) => p.access === "github-org");
		if (githubOrgPaths.length > 0) {
			if (!args.githubIdentityProviderId) {
				throw new Error(
					"githubIdentityProviderId is required when using github-org access",
				);
			}
			if (!args.githubOrganizations || args.githubOrganizations.length === 0) {
				throw new Error(
					"githubOrganizations must not be empty when using github-org access",
				);
			}
		}

		const resourceOpts = { parent: this };

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

		this.worker = new cloudflare.WorkersScript(
			`${name}-worker`,
			{
				accountId: args.accountId,
				scriptName: args.name,
				content: scriptContent,
				bindings: [
					{
						name: bucketBinding,
						bucketName: bucketName,
						type: "r2_bucket",
					},
					{
						name: "CACHE_TTL_SECONDS",
						text: pulumi.output(cacheTtl).apply((ttl) => ttl.toString()),
						type: "plain_text",
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
						content: "100::", // Workers placeholder IPv6
						proxied: true, // Enable Cloudflare proxy
						ttl: 1, // Automatic TTL (required by Cloudflare provider)
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
					service: this.worker.scriptName,
					zoneId: args.zoneId,
					environment: "production",
				},
				workerDomainOpts,
			);
			this.workerDomains.push(workerDomain);
		}

		// 4. Create Access Applications with embedded policies for each (domain, path) combination
		this.accessApplications = [];

		for (let domainIdx = 0; domainIdx < args.domains.length; domainIdx++) {
			const domain = args.domains[domainIdx];

			for (let pathIdx = 0; pathIdx < args.paths.length; pathIdx++) {
				const pathConfig = args.paths[pathIdx];

				// Create policy include rules based on access type
				const policyIncludes =
					pathConfig.access === "public"
						? [{ everyone: true }]
						: pulumi
								.all([
									pulumi.all(args.githubOrganizations),
									args.githubIdentityProviderId,
								])
								.apply(
									([orgs, idpId]) =>
										orgs.map((org) => ({
											github: {
												identityProviderId: idpId,
												name: org,
											},
										})) as cloudflare.types.input.ZeroTrustAccessApplicationPolicyInclude[],
								);

				// Create Access Application with embedded policy
				const app = new cloudflare.ZeroTrustAccessApplication(
					`${name}-app-d${domainIdx}-p${pathIdx}`,
					{
						accountId: args.accountId,
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
						policies: [
							{
								name:
									pathConfig.access === "public"
										? "Allow everyone"
										: "GitHub org members",
								decision: "allow",
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

		// Outputs
		this.boundDomains = pulumi.output(args.domains);
		this.workerName = this.worker.scriptName;

		this.registerOutputs({
			bucket: this.bucket,
			worker: this.worker,
			workerDomains: this.workerDomains,
			dnsRecords: this.dnsRecords,
			accessApplications: this.accessApplications,
			boundDomains: this.boundDomains,
			workerName: this.workerName,
		});
	}
}

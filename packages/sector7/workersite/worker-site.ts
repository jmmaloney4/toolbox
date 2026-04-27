import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import {
	generateWorkerScript,
	type RedirectRule,
} from "./worker-site-script.ts";

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
	 * - "public": Allow everyone (visitors still complete the Cloudflare Zero Trust login flow)
	 * - "bypass": Bypass authentication entirely — requests go directly to the Worker with no login prompt
	 * - "github-org": Require GitHub organization membership
	 */
	access: "public" | "bypass" | "github-org";
}

/**
 * Configuration for providing a custom pre-built Worker script.
 *
 * Use this when you need redirect logic, custom bindings, or any behavior
 * that the generated script does not support.  The caller is responsible
 * for building and providing the script content.
 */
export interface WorkerScriptConfig {
	/**
	 * The Worker script content (ESM format recommended).
	 * This replaces the auto-generated script entirely.
	 */
	content: pulumi.Input<string>;

	/**
	 * Extra plain_text bindings to pass to the Worker in addition to the
	 * standard R2_BUCKET and CACHE_TTL_SECONDS bindings.
	 *
	 * @example
	 * ```typescript
	 * extraBindings: [
	 *   { name: "APEX_DOMAIN", text: "example.com" },
	 *   { name: "WWW_DOMAIN",  text: "www.example.com" },
	 * ]
	 * ```
	 */
	extraBindings?: Array<{
		name: pulumi.Input<string>;
		text: pulumi.Input<string>;
	}>;
}

/**
 * Configuration for auto-creating a GitHub OAuth Identity Provider in
 * Cloudflare Zero Trust Access.
 *
 * When provided, WorkerSite creates a `ZeroTrustAccessIdentityProvider`
 * resource (type `"github"`) and uses its generated ID for any paths with
 * `access: "github-org"`.  This is the preferred alternative to passing a
 * pre-existing `githubIdentityProviderId` — the two options are mutually
 * exclusive.
 *
 * The GitHub OAuth App must be created manually in
 * GitHub Settings → Developer settings → OAuth Apps.
 * The callback URL should be `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`.
 */
export interface GithubOAuthConfig {
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
 * Configuration for Cloudflare Worker observability.
 */
export interface WorkerObservabilityConfig {
	/**
	 * Whether request observability is enabled for the Worker.
	 * @default true
	 */
	enabled?: pulumi.Input<boolean>;

	/**
	 * Sampling rate for incoming requests. 0.1 = 10%, 1 = 100%.
	 * @default 0.1
	 */
	headSamplingRate?: pulumi.Input<number>;

	/**
	 * Log settings for the Worker.
	 */
	logs?: {
		/**
		 * Whether Worker logs are enabled.
		 * Defaults to the resolved observability enabled value.
		 */
		enabled?: pulumi.Input<boolean>;

		/**
		 * Sampling rate for logs. Defaults to `headSamplingRate`.
		 * @default 0.1
		 */
		headSamplingRate?: pulumi.Input<number>;

		/**
		 * Whether invocation logs are enabled.
		 * Defaults to the resolved logs enabled value.
		 */
		invocationLogs?: pulumi.Input<boolean>;

		/**
		 * Log destinations supported by Cloudflare.
		 * @default ["cloudflare"]
		 */
		destinations?: pulumi.Input<string>[];

		/**
		 * Whether logs should be persisted by Cloudflare.
		 * Defaults to true when both observability and logs are enabled, false otherwise.
		 */
		persist?: pulumi.Input<boolean>;
	};
}

/**
 * Arguments for creating a WorkerSite component (ADR-011).
 *
 * @remarks
 * Phase 2 / ADR-011 features:
 * - Multiple domains via WorkersCustomDomain (DNS managed automatically)
 * - Optional path-level access control (Zero Trust; omit for fully public sites)
 * - R2 backend with Cache API
 * - Configurable cache TTL
 * - Optional declarative R2 asset uploads via the sibling `./r2` sub-path (ADR-014)
 * - Optional host-level redirect rules injected into the generated Worker script
 * - Optional custom Worker script with extra bindings
 */
export interface WorkerSiteArgs {
	/**
	 * Cloudflare account ID where resources will be created.
	 */
	accountId: pulumi.Input<string>;

	/**
	 * Cloudflare zone ID for the domain.
	 * Required for `WorkersCustomDomain` bindings.
	 */
	zoneId: pulumi.Input<string>;

	/**
	 * Name for the Worker and related resources.
	 */
	name: pulumi.Input<string>;

	/**
	 * Domains to bind the Worker to (e.g., ["site.example.com", "www.site.example.com"]).
	 *
	 * Each domain gets a `WorkersCustomDomain` resource that automatically manages
	 * DNS.  No explicit `cloudflare.Record` resources are created.
	 */
	domains: pulumi.Input<string>[];

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

		/**
		 * R2 bucket location jurisdiction identifier used when constructing the
		 * API token resource string (e.g. `"wnam"`, `"enam"`, `"weur"`).
		 * Ignored when the bucket is created by this component (`bucket.location`
		 * is used instead).
		 * @default "default" (Cloudflare's default jurisdiction)
		 */
		location?: pulumi.Input<string>;
	};

	/**
	 * GitHub Identity Provider ID in Cloudflare Access.
	 * Required only when at least one path has `access: "github-org"` and
	 * `githubOAuthConfig` is not provided.
	 *
	 * Mutually exclusive with `githubOAuthConfig`.
	 */
	githubIdentityProviderId?: pulumi.Input<string>;

	/**
	 * GitHub organization name(s) for restricted path access.
	 * Required only when at least one path has `access: "github-org"`.
	 */
	githubOrganizations?: pulumi.Input<string>[];

	/**
	 * Auto-create a GitHub OAuth Identity Provider for Cloudflare Access.
	 * When provided, a `ZeroTrustAccessIdentityProvider` resource is created
	 * and its ID is used for any paths with `access: "github-org"`.
	 *
	 * Mutually exclusive with `githubIdentityProviderId`.
	 *
	 * @example
	 * ```typescript
	 * githubOAuthConfig: {
	 *   clientId: "Ov23li...",
	 *   clientSecret: pulumi.secret("abc123..."),
	 * },
	 * githubOrganizations: ["my-org"],
	 * paths: [
	 *   { pattern: "/*", access: "github-org" },
	 * ],
	 * ```
	 */
	githubOAuthConfig?: GithubOAuthConfig;

	/**
	 * Path access configurations for Zero Trust Access Applications.
	 * Omit entirely for fully public sites — no Access Applications will be created.
	 *
	 * @example
	 * ```typescript
	 * paths: [
	 *   { pattern: "/", access: "bypass" },
	 *   { pattern: "/styles.css", access: "bypass" },
	 *   { pattern: "/blog/*", access: "public" },
	 *   { pattern: "/research/*", access: "github-org" },
	 * ]
	 * ```
	 */
	paths?: PathConfig[];

	/**
	 * Cache TTL in seconds for static assets.
	 * @default 31536000 (1 year)
	 */
	cacheTtlSeconds?: pulumi.Input<number>;

	/**
	 * Host-level HTTP redirect rules injected into the generated Worker script.
	 * Evaluated before R2 serving.  Ignored when `workerScript` is set.
	 *
	 * @example
	 * ```typescript
	 * redirects: [{ fromHost: "www.example.com", toHost: "example.com", statusCode: 301 }]
	 * ```
	 */
	redirects?: RedirectRule[];

	/**
	 * Custom pre-built Worker script configuration.
	 * When set, the auto-generated script is replaced entirely.
	 * `redirects` is ignored when this is set.
	 */
	workerScript?: WorkerScriptConfig;

	/**
	 * Cloudflare Worker observability settings.
	 *
	 * Defaults enable observability and invocation logs with 10% sampling to the
	 * Cloudflare destination. Raise sampling to `1` during incident response.
	 */
	observability?: WorkerObservabilityConfig;
}

/**
 * WorkerSite component for hosting static sites on Cloudflare Workers.
 *
 * @remarks
 * ADR-011 implementation with:
 * - R2-backed Worker serving static files with Cache API
 * - Multiple domains via WorkersCustomDomain
 * - Optional Zero Trust access control per path
 * - Optional declarative R2 asset uploads via the sibling `./r2` sub-path (ADR-014)
 * - Optional host-level redirect rules
 * - Optional custom Worker script with extra bindings
 *
 * @example
 * Fully public site with www redirect:
 * ```typescript
 * const site = new WorkerSite("my-site", {
 *   accountId: "abc123",
 *   zoneId: "xyz789",
 *   name: "my-site",
 *   domains: ["example.com", "www.example.com"],
 *   r2Bucket: { bucketName: "my-site-assets", create: true },
 *   redirects: [{ fromHost: "www.example.com", toHost: "example.com" }],
 * });
 * // Upload assets separately via the r2 sub-path:
 * // import { uploadAssets } from "@jmmaloney4/sector7/r2";
 * // uploadAssets("my-site", { accountId, bucketName, files }, { parent: site });
 * ```
 *
 * @example
 * Site with GitHub org access control using auto-created Identity Provider:
 * ```typescript
 * const site = new WorkerSite("docs-site", {
 *   accountId: "abc123",
 *   zoneId: "xyz789",
 *   name: "docs-site",
 *   domains: ["docs.example.com"],
 *   r2Bucket: { bucketName: "docs-site-assets", create: true },
 *   githubOAuthConfig: {
 *     clientId: "Ov23li...",
 *     clientSecret: pulumi.secret("abc123..."),
 *   },
 *   githubOrganizations: ["my-org"],
 *   paths: [
 *     { pattern: "/", access: "bypass" },
 *     { pattern: "/styles.css", access: "bypass" },
 *     { pattern: "/public/*", access: "public" },
 *     { pattern: "/private/*", access: "github-org" },
 *   ],
 * });
 * ```
 */
export class WorkerSite extends pulumi.ComponentResource {
	/**
	 * The R2 bucket storing static assets (present when r2Bucket.create = true).
	 */
	public readonly bucket: cloudflare.R2Bucket | undefined;

	/**
	 * The Worker script serving static files.
	 */
	public readonly worker: cloudflare.WorkersScript;

	/**
	 * Worker custom domains binding the Worker to each domain.
	 */
	public readonly workerDomains: cloudflare.WorkersCustomDomain[];

	/**
	 * Zero Trust Access Applications for each (domain, path) combination.
	 * Populated when path configuration is provided, even if all paths are public.
	 * Empty when no paths are configured.
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

		if (!args.zoneId) {
			throw new Error(
				"zoneId is required because WorkersCustomDomain depends on it",
			);
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

		const resourceOpts = { parent: this };

		// 0. Auto-create GitHub Identity Provider if requested
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

		// 2. Build Worker script content
		const bucketBinding = "R2_BUCKET";
		const cacheTtl = args.cacheTtlSeconds ?? 31536000; // Default 1 year
		const prefix = args.r2Bucket.prefix
			? pulumi.output(args.r2Bucket.prefix)
			: undefined;
		// Resolve observability defaults via pulumi.all so that nested flags
		// cascade from their parent: logs.enabled defaults to observability
		// enabled, invocationLogs defaults to logs.enabled, etc.  This avoids
		// contradictory combinations like enabled:false with logs.enabled:true.
		const workerObservability = pulumi
			.all([
				args.observability?.enabled ?? true,
				args.observability?.headSamplingRate ?? 0.1,
				args.observability?.logs?.enabled,
				args.observability?.logs?.headSamplingRate,
				args.observability?.logs?.invocationLogs,
				args.observability?.logs?.destinations,
				args.observability?.logs?.persist,
			])
			.apply(
				([
					obsEnabled,
					headSamplingRate,
					logsEnabledRaw,
					logHeadSamplingRateRaw,
					invocationLogsRaw,
					destinationsRaw,
					persistRaw,
				]) => {
					const logsEnabled = logsEnabledRaw ?? obsEnabled;
					return {
						enabled: obsEnabled,
						headSamplingRate,
						logs: {
							enabled: logsEnabled,
							headSamplingRate: logHeadSamplingRateRaw ?? headSamplingRate,
							invocationLogs: invocationLogsRaw ?? logsEnabled,
							destinations: destinationsRaw ?? ["cloudflare"],
							persist: persistRaw ?? (obsEnabled && logsEnabled),
						},
					};
				},
			);

		let scriptContent: pulumi.Input<string>;
		let extraBindings: Array<{
			name: pulumi.Input<string>;
			text: pulumi.Input<string>;
			type: "plain_text";
		}> = [];

		if (args.workerScript) {
			// Custom script takes priority — use as-is
			scriptContent = args.workerScript.content;
			extraBindings = (args.workerScript.extraBindings ?? []).map((b) => ({
				...b,
				type: "plain_text" as const,
			}));
		} else {
			// Generate default script, optionally with redirect rules
			scriptContent = prefix
				? prefix.apply((p: string) =>
						generateWorkerScript(bucketBinding, p, args.redirects),
					)
				: generateWorkerScript(bucketBinding, undefined, args.redirects);
		}

		// 3. Create WorkersScript
		this.worker = new cloudflare.WorkersScript(
			`${name}-worker`,
			{
				accountId: args.accountId,
				scriptName: args.name,
				content: scriptContent,
				mainModule: "worker.js",
				bindings: [
					{
						name: bucketBinding,
						bucketName: bucketName,
						type: "r2_bucket",
					},
					{
						name: "CACHE_TTL_SECONDS",
						text: pulumi
							.output(cacheTtl)
							.apply((ttl: number) => ttl.toString()),
						type: "plain_text",
					},
					...extraBindings,
				],
				observability: workerObservability,
			},
			resourceOpts,
		);

		// 4. Create WorkersCustomDomain for each domain
		//    WorkersCustomDomain automatically manages DNS records; no explicit
		//    cloudflare.Record resources are needed (see issue #113).
		this.workerDomains = [];

		for (let i = 0; i < args.domains.length; i++) {
			const domain = args.domains[i];

			const workerDomain = new cloudflare.WorkersCustomDomain(
				`${name}-domain-${i}`,
				{
					accountId: args.accountId,
					hostname: domain,
					service: this.worker.scriptName,
					zoneId: args.zoneId,
					environment: "production",
				},
				resourceOpts,
			);
			this.workerDomains.push(workerDomain);
		}

		// 5. Create Zero Trust Access Applications (optional)
		this.accessApplications = [];

		if (args.paths && args.paths.length > 0) {
			for (let domainIdx = 0; domainIdx < args.domains.length; domainIdx++) {
				const domain = args.domains[domainIdx];

				for (let pathIdx = 0; pathIdx < args.paths.length; pathIdx++) {
					const pathConfig = args.paths[pathIdx];

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
							type: "self_hosted",
							sessionDuration: "24h",
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
		}

		// Outputs
		this.boundDomains = pulumi.output(args.domains);
		this.workerName = this.worker.scriptName;

		this.registerOutputs({
			bucket: this.bucket,
			worker: this.worker,
			workerDomains: this.workerDomains,
			accessApplications: this.accessApplications,
			githubIdp: this.githubIdp,
			boundDomains: this.boundDomains,
			workerName: this.workerName,
		});
	}
}

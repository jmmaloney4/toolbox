import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import { R2Object } from "./r2object.ts";
import { generateWorkerScript, type RedirectRule } from "./worker-site-script.ts";

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
 * A single static file to upload to R2 as a Pulumi-managed resource.
 */
export interface AssetFile {
	/**
	 * Absolute path to the local file on disk.
	 */
	filePath: pulumi.Input<string>;

	/**
	 * R2 object key (e.g., "index.html", "styles/main.css").
	 */
	key: pulumi.Input<string>;

	/**
	 * MIME content type (e.g., "text/html; charset=utf-8").
	 */
	contentType: pulumi.Input<string>;
}

/**
 * Configuration for declarative R2 asset uploads.
 *
 * When provided, WorkerSite creates a scoped R2 API token and uploads each
 * listed file as a separate Pulumi dynamic resource.  Content changes are
 * detected via MD5 comparison against the stored ETag — no external binary
 * required.
 *
 * Notes
 * -----
 * The generated AccountToken is scoped to R2_BUCKET_ITEM_WRITE on the specific
 * bucket only.  Credentials are derived per Cloudflare's spec:
 *   accessKeyId     = token.id
 *   secretAccessKey = SHA-256(token.value)
 */
export interface AssetConfig {
	/**
	 * Files to upload.  Each file becomes a separate Pulumi R2Object resource.
	 */
	files: AssetFile[];
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
 * Arguments for creating a WorkerSite component (ADR-011).
 *
 * @remarks
 * Phase 2 / ADR-011 features:
 * - Multiple domains via WorkersCustomDomain (DNS managed automatically)
 * - Optional path-level access control (Zero Trust; omit for fully public sites)
 * - R2 backend with Cache API
 * - Configurable cache TTL
 * - Optional declarative R2 asset uploads (AssetConfig)
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
	};

	/**
	 * GitHub Identity Provider ID in Cloudflare Access.
	 * Required only when at least one path has `access: "github-org"`.
	 */
	githubIdentityProviderId?: pulumi.Input<string>;

	/**
	 * GitHub organization name(s) for restricted path access.
	 * Required only when at least one path has `access: "github-org"`.
	 */
	githubOrganizations?: pulumi.Input<string>[];

	/**
	 * Path access configurations for Zero Trust Access Applications.
	 * Omit entirely for fully public sites — no Access Applications will be created.
	 *
	 * @example
	 * ```typescript
	 * paths: [
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
	 * Declarative R2 asset upload configuration.
	 * When set, WorkerSite creates a scoped API token and uploads each file as
	 * a separate Pulumi dynamic resource with MD5-based change detection.
	 */
	assets?: AssetConfig;

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
}

// Cloudflare permission group ID for R2 bucket item write access.
// Used to scope the API token created for asset uploads.
const R2_BUCKET_ITEM_WRITE_PERMISSION_GROUP_ID =
	"2efd5506f9c8494dacb1fa10a3e7d5b6";

/**
 * WorkerSite component for hosting static sites on Cloudflare Workers.
 *
 * @remarks
 * ADR-011 implementation with:
 * - R2-backed Worker serving static files with Cache API
 * - Multiple domains via WorkersCustomDomain
 * - Optional Zero Trust access control per path
 * - Optional declarative R2 asset uploads
 * - Optional host-level redirect rules
 * - Optional custom Worker script with extra bindings
 *
 * @example
 * Fully public site with asset upload and www redirect:
 * ```typescript
 * const site = new WorkerSite("my-site", {
 *   accountId: "abc123",
 *   zoneId: "xyz789",
 *   name: "my-site",
 *   domains: ["example.com", "www.example.com"],
 *   r2Bucket: { bucketName: "my-site-assets", create: true },
 *   redirects: [{ fromHost: "www.example.com", toHost: "example.com" }],
 *   assets: {
 *     files: [
 *       { key: "index.html", filePath: "/dist/index.html", contentType: "text/html" },
 *     ],
 *   },
 * });
 * ```
 *
 * @example
 * Site with GitHub org access control:
 * ```typescript
 * const site = new WorkerSite("docs-site", {
 *   accountId: "abc123",
 *   zoneId: "xyz789",
 *   name: "docs-site",
 *   domains: ["docs.example.com"],
 *   r2Bucket: { bucketName: "docs-site-assets", create: true },
 *   githubIdentityProviderId: "github-idp-id",
 *   githubOrganizations: ["my-org"],
 *   paths: [
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
	 * Empty when no paths with access control are configured.
	 */
	public readonly accessApplications: cloudflare.ZeroTrustAccessApplication[];

	/**
	 * Uploaded R2 objects (populated when assets is provided).
	 */
	public readonly uploadedAssets: R2Object[];

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

		const githubOrgPaths = (args.paths ?? []).filter(
			(p) => p.access === "github-org",
		);
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

		// 2. Build Worker script content
		const bucketBinding = "R2_BUCKET";
		const cacheTtl = args.cacheTtlSeconds ?? 31536000; // Default 1 year
		const prefix = args.r2Bucket.prefix
			? pulumi.output(args.r2Bucket.prefix)
			: undefined;

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
						pathConfig.access === "public"
							? [{ everyone: true }]
							: pulumi
									.all([
										pulumi.all(args.githubOrganizations ?? []),
										args.githubIdentityProviderId ?? "",
									])
									.apply(
										([orgs, idpId]: [string[], string]) =>
											orgs.map((org: string) => ({
												github: {
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
		}

		// 6. Upload static assets (optional)
		this.uploadedAssets = [];

		if (args.assets && args.assets.files.length > 0) {
			// Create a scoped R2 API token for uploads.
			// accessKeyId = token.id
			// secretAccessKey = SHA-256(token.value)  (Cloudflare R2 S3-compat spec)
			const r2Token = new cloudflare.AccountToken(
				`${name}-r2-token`,
				{
					accountId: args.accountId,
					name: pulumi.interpolate`${args.name}-r2-upload`,
					policies: [
						{
							permissionGroups: [
								{
									id: R2_BUCKET_ITEM_WRITE_PERMISSION_GROUP_ID,
								},
							],
							resources: pulumi.all([args.accountId, bucketName]).apply(
								([acctId, bktName]: [string, string]) =>
									({
										[`com.cloudflare.edge.r2.bucket.${acctId}_default_${bktName}`]:
											"*",
									}) as Record<string, string>,
							),
						},
					],
				},
				resourceOpts,
			);

			const accessKeyId = r2Token.id;
			const secretAccessKey = r2Token.value.apply((v: string) => {
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				const crypto = require("node:crypto") as typeof import("node:crypto");
				return crypto.createHash("sha256").update(v).digest("hex");
			});

			for (const file of args.assets.files) {
				// Sanitize file key for use as Pulumi resource name
				const safeKey = pulumi
					.output(file.key)
					.apply((k: string) => k.replace(/[^a-zA-Z0-9]/g, "-"));

				const r2obj = new R2Object(
					pulumi.interpolate`${name}-asset-${safeKey}`,
					{
						accountId: args.accountId,
						bucketName: bucketName,
						key: file.key,
						filePath: file.filePath,
						contentType: file.contentType,
						accessKeyId,
						secretAccessKey,
					},
					{
						...resourceOpts,
						dependsOn: [this.worker, ...(this.bucket ? [this.bucket] : [])],
					},
				);
				this.uploadedAssets.push(r2obj);
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
			uploadedAssets: this.uploadedAssets,
			boundDomains: this.boundDomains,
			workerName: this.workerName,
		});
	}
}

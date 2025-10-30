import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import { generateWorkerScript } from "./worker-site-script";

/**
 * Arguments for creating a WorkerSite component (Phase 1 MVP).
 *
 * @remarks
 * Phase 1 MVP is intentionally limited to:
 * - Single domain via WorkerRoute
 * - Exactly 2 paths: one public (`/blog/*`), one restricted (`/research/*`)
 * - R2 backend only
 * - No caching (Cache API requires custom domains, deferred to Phase 2)
 * - No SPA fallback (deferred to Phase 3)
 */
export interface WorkerSiteArgs {
	/**
	 * Cloudflare account ID where resources will be created.
	 */
	accountId: pulumi.Input<string>;

	/**
	 * Cloudflare zone ID for the domain (required for WorkerRoute).
	 */
	zoneId: pulumi.Input<string>;

	/**
	 * Name for the Worker and related resources.
	 */
	name: pulumi.Input<string>;

	/**
	 * Domain to bind the Worker to (e.g., "site.example.com").
	 * Phase 1 MVP: Single domain only.
	 */
	domain: pulumi.Input<string>;

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
		create?: pulumi.Input<boolean>;

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
	 * Members of these organizations will be allowed to access restricted paths.
	 */
	githubOrganizations: pulumi.Input<string>[];

	/**
	 * Public path pattern (e.g., "/blog/*").
	 * Phase 1 MVP: Single public path.
	 */
	publicPath: pulumi.Input<string>;

	/**
	 * Restricted path pattern (e.g., "/research/*").
	 * Phase 1 MVP: Single restricted path.
	 */
	restrictedPath: pulumi.Input<string>;
}

/**
 * WorkerSite component for hosting static sites on Cloudflare Workers with Zero Trust access control.
 *
 * @remarks
 * Phase 1 MVP implementation with:
 * - R2-backed Worker serving static files
 * - Single domain via WorkerRoute
 * - Two paths: one public, one restricted to GitHub org members
 * - Basic Access integration
 *
 * @example
 * ```typescript
 * const site = new WorkerSite("docs-site", {
 *   accountId: "abc123",
 *   zoneId: "xyz789",
 *   name: "docs-site",
 *   domain: "docs.example.com",
 *   r2Bucket: {
 *     bucketName: "docs-site-assets",
 *     create: true,
 *   },
 *   githubIdentityProviderId: "github-idp-id",
 *   githubOrganizations: ["my-org"],
 *   publicPath: "/blog/*",
 *   restrictedPath: "/research/*",
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
	 * The Worker route binding the Worker to the domain.
	 */
	public readonly route: cloudflare.WorkerRoute;

	/**
	 * Access Application for the public path.
	 */
	public readonly publicAccessApp: cloudflare.AccessApplication;

	/**
	 * Access Policy for the public path (allow everyone).
	 */
	public readonly publicAccessPolicy: cloudflare.AccessPolicy;

	/**
	 * Access Application for the restricted path.
	 */
	public readonly restrictedAccessApp: cloudflare.AccessApplication;

	/**
	 * Access Policy for the restricted path (GitHub org members).
	 */
	public readonly restrictedAccessPolicy: cloudflare.AccessPolicy;

	/**
	 * The domain bound to the Worker.
	 */
	public readonly boundDomain: pulumi.Output<string>;

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

		const resourceOpts = { parent: this };

		// 1. Create or reference R2 bucket
		if (pulumi.output(args.r2Bucket.create).apply((c) => c === true)) {
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

		// 2. Create Worker script
		const bucketBinding = "R2_BUCKET";
		const scriptContent = generateWorkerScript(bucketBinding);

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
			},
			resourceOpts,
		);

		// 3. Create Worker route
		this.route = new cloudflare.WorkerRoute(
			`${name}-route`,
			{
				zoneId: args.zoneId,
				pattern: pulumi.interpolate`${args.domain}/*`,
				scriptName: this.worker.name,
			},
			resourceOpts,
		);

		// 4. Create Access Application for public path
		this.publicAccessApp = new cloudflare.AccessApplication(
			`${name}-public-app`,
			{
				zoneId: args.zoneId,
				name: pulumi.interpolate`${args.name}-public`,
				domain: pulumi.interpolate`${args.domain}${args.publicPath}`,
				type: "self_hosted",
				sessionDuration: "24h",
			},
			resourceOpts,
		);

		// 5. Create Access Policy for public path (allow everyone)
		this.publicAccessPolicy = new cloudflare.AccessPolicy(
			`${name}-public-policy`,
			{
				applicationId: this.publicAccessApp.id,
				zoneId: args.zoneId,
				name: "Allow everyone",
				decision: "allow",
				precedence: 1,
				includes: [
					{
						everyone: true,
					},
				],
			},
			resourceOpts,
		);

		// 6. Create Access Application for restricted path
		this.restrictedAccessApp = new cloudflare.AccessApplication(
			`${name}-restricted-app`,
			{
				zoneId: args.zoneId,
				name: pulumi.interpolate`${args.name}-restricted`,
				domain: pulumi.interpolate`${args.domain}${args.restrictedPath}`,
				type: "self_hosted",
				sessionDuration: "24h",
			},
			resourceOpts,
		);

		// 7. Create Access Policy for restricted path (GitHub org members)
		// Note: We need to create one include per GitHub org
		this.restrictedAccessPolicy = new cloudflare.AccessPolicy(
			`${name}-restricted-policy`,
			{
				applicationId: this.restrictedAccessApp.id,
				zoneId: args.zoneId,
				name: "GitHub org members",
				decision: "allow",
				precedence: 1,
				includes: pulumi
					.all([args.githubOrganizations, args.githubIdentityProviderId])
					.apply(
						([orgs, idpId]) =>
							orgs.map((org) => ({
								github: {
									identityProviderId: idpId,
									name: org,
								},
							})) as any,
					),
			},
			resourceOpts,
		);

		// Outputs
		this.boundDomain = pulumi.output(args.domain);
		this.workerName = this.worker.name;

		this.registerOutputs({
			bucket: this.bucket,
			worker: this.worker,
			route: this.route,
			publicAccessApp: this.publicAccessApp,
			publicAccessPolicy: this.publicAccessPolicy,
			restrictedAccessApp: this.restrictedAccessApp,
			restrictedAccessPolicy: this.restrictedAccessPolicy,
			boundDomain: this.boundDomain,
			workerName: this.workerName,
		});
	}
}

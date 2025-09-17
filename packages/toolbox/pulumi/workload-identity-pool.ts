import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";

/**
 * Arguments for creating a reusable GCP Workload Identity Pool.
 *
 * @remarks
 * This component is intentionally small and reusable so that multiple
 * Workload Identity Providers (e.g., for GitHub Actions or other OIDC
 * issuers) can attach to the same pool.
 */
export interface WorkloadIdentityPoolArgs {
	/**
	 * Short identifier for the pool.
	 *
	 * This becomes the pool ID segment in the resource name.
	 * Example: `github-${pulumi.getStack()}`.
	 */
	poolId: pulumi.Input<string>;
	/** Human-friendly display name for the pool. */
	displayName: pulumi.Input<string>;
	/** Optional description for the pool. */
	description?: pulumi.Input<string>;
}

/**
 * Reusable component that creates a GCP Workload Identity Pool.
 *
 * @example
 * const pool = new WorkloadIdentityPoolResource("github-pool", {
 * 	poolId: pulumi.interpolate`github-${pulumi.getStack()}`,
 * 	displayName: "GitHub Actions",
 * 	description: "Identity pool for GitHub Actions",
 * });
 */
export class WorkloadIdentityPoolResource extends pulumi.ComponentResource {
	/** The underlying `gcp.iam.WorkloadIdentityPool` resource. */
	public readonly pool: gcp.iam.WorkloadIdentityPool;
	/** Full resource name of the pool, e.g., `projects/.../locations/global/workloadIdentityPools/...`. */
	public readonly name: pulumi.Output<string>;
	/** The pool ID (short name) that callers use when attaching providers. */
	public readonly workloadIdentityPoolId: pulumi.Output<string>;

	/**
	 * Create a new `WorkloadIdentityPoolResource`.
	 *
	 * @param name - Pulumi resource name prefix.
	 * @param args - Configuration for the pool.
	 * @param opts - Standard Pulumi resource options.
	 */
	constructor(
		name: string,
		args: WorkloadIdentityPoolArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		super("custom:gcp:workloadIdentityPool", name, args, opts);

		const pool = new gcp.iam.WorkloadIdentityPool(
			`${name}`,
			{
				workloadIdentityPoolId: args.poolId,
				displayName: args.displayName,
				description: args.description ?? "A GCP Workload Identity Pool",
			},
			{ parent: this },
		);

		this.pool = pool;
		this.name = pool.name as pulumi.Output<string>;
		this.workloadIdentityPoolId = pool.workloadIdentityPoolId as pulumi.Output<string>;

		this.registerOutputs({
			name: this.name,
			workloadIdentityPoolId: this.workloadIdentityPoolId,
		});
	}
}



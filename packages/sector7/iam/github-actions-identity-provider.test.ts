import * as pulumi from "@pulumi/pulumi";
import {
	GithubActionsWorkloadIdentityProvider,
	generateProviderId,
	generateServiceAccountId,
} from "./github-actions-identity-provider";
import { WorkloadIdentityPoolResource } from "./workload-identity-pool";

// Mock Pulumi runtime
pulumi.runtime.setMocks({
	newResource: (
		args: pulumi.runtime.MockResourceArgs,
	): { id: string; state: any } => {
		let state = args.inputs;
		if (args.type === "gcp:serviceaccount/account:Account") {
			state = {
				...args.inputs,
				email: "test-sa@project.iam.gserviceaccount.com",
			};
		}
		return {
			id: args.name + "_id",
			state: state,
		};
	},
	call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
});

describe("ID Generation Logic", () => {
	describe("generateServiceAccountId", () => {
		it("should generate correct ID for short inputs", () => {
			const id = generateServiceAccountId("owner", "repo", "stack");
			expect(id).toBe("sa-owner-repo-stack");
		});

		it("should truncate long owner names to 12 chars", () => {
			const longOwner = "thisisaverylongownername";
			const id = generateServiceAccountId(longOwner, "repo", "stack");
			expect(id).toBe("sa-thisisaveryl-repo-stack");
		});

		it("should truncate long repo names to 10 chars", () => {
			const longRepo = "thisisaverylongreponame";
			const id = generateServiceAccountId("owner", longRepo, "stack");
			expect(id).toBe("sa-owner-thisisaver-stack");
		});

		it("should throw error if stack name > 5 chars", () => {
			expect(() => {
				generateServiceAccountId("owner", "repo", "stack123");
			}).toThrow(/Stack name "stack123" exceeds 5 character limit/);
		});

		it("should handle mixed long inputs correctly", () => {
			const id = generateServiceAccountId(
				"thisisaverylongownername",
				"thisisaverylongreponame",
				"stack",
			);
			expect(id).toBe("sa-thisisaveryl-thisisaver-stack");
			expect(id.length).toBeLessThanOrEqual(32);
		});
	});

	describe("generateProviderId", () => {
		it("should generate correct ID for short inputs", () => {
			const id = generateProviderId("owner", "repo", "stack");
			expect(id).toBe("provider-owner-repo-stack");
		});

		it("should truncate long owner names to 8 chars", () => {
			const longOwner = "thisisaverylongownername";
			const id = generateProviderId(longOwner, "repo", "stack");
			expect(id).toBe("provider-thisisav-repo-stack");
		});

		it("should truncate long repo names to 8 chars", () => {
			const longRepo = "thisisaverylongreponame";
			const id = generateProviderId("owner", longRepo, "stack");
			expect(id).toBe("provider-owner-thisisav-stack");
		});

		it("should throw error if stack name > 5 chars", () => {
			expect(() => {
				generateProviderId("owner", "repo", "stack123");
			}).toThrow(/Stack name "stack123" exceeds 5 character limit/);
		});

		it("should handle mixed long inputs correctly", () => {
			const id = generateProviderId(
				"thisisaverylongownername",
				"thisisaverylongreponame",
				"stack",
			);
			expect(id).toBe("provider-thisisav-thisisav-stack");
			expect(id.length).toBeLessThanOrEqual(32);
		});
	});
});

describe("GithubActionsWorkloadIdentityProvider", () => {
	const pool = new WorkloadIdentityPoolResource("test-pool", {
		poolId: "pool-id",
		displayName: "Pool",
	});

	it("should create resources with correct properties", async () => {
		const provider = new GithubActionsWorkloadIdentityProvider(
			"test-provider",
			{
				repoOwner: "owner",
				repoName: "repo",
				serviceAccountRoles: {
					"roles/viewer": ["project-1"],
				},
				pool: pool,
			},
		);

		const saEmail = await getOutput(provider.serviceAccountEmail);
		expect(saEmail).toBeDefined();

		const providerResource = await getOutput(
			provider.workloadIdentityProviderResource,
		);
		expect(providerResource).toBeDefined();
	});
});

// Helper to unwrap promises/outputs
function getOutput<T>(output: pulumi.Input<T> | undefined): Promise<T> {
	if (!output) {
		return Promise.resolve(undefined as T);
	}
	return new Promise((resolve) => {
		pulumi.output(output).apply((value) => resolve(value as T));
	});
}


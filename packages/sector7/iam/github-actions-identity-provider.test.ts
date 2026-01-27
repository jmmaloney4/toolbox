import * as pulumi from "@pulumi/pulumi";
import { describe, it, expect, beforeAll } from "vitest";

// Mock Pulumi runtime before importing the component
pulumi.runtime.setMocks({
	newResource: function(args: pulumi.runtime.MockResourceArgs): {id: string, state: any} {
		let state = { ...args.inputs };
		if (args.type === "gcp:serviceaccount/account:Account") {
			// Mock the email generation based on accountId
			const accountId = args.inputs.accountId;
			state = {
				...state,
				email: `${accountId}@test-project.iam.gserviceaccount.com`,
				name: `projects/test-project/serviceAccounts/${accountId}@test-project.iam.gserviceaccount.com`,
			};
		}
		if (args.type === "gcp:iam/workloadIdentityPool:WorkloadIdentityPool") {
			state = {
				...state,
				workloadIdentityPoolId: "projects/test-project/locations/global/workloadIdentityPools/test-pool",
				name: "projects/test-project/locations/global/workloadIdentityPools/test-pool",
			};
		}
		if (args.type === "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider") {
			const providerId = args.inputs.workloadIdentityPoolProviderId;
			state = {
				...state,
				name: `projects/test-project/locations/global/workloadIdentityPools/test-pool/providers/${providerId}`,
			};
		}
		return {
			id: args.name + "_id",
			state: state,
		};
	},
	call: function(args: pulumi.runtime.MockCallArgs) {
		return args.inputs;
	},
});

import { GithubActionsWorkloadIdentityProvider } from "./github-actions-identity-provider";
import { WorkloadIdentityPoolResource } from "./workload-identity-pool";

describe("GithubActionsWorkloadIdentityProvider", () => {
	it("should create resources successfully and generate correct IDs", async () => {
		const pool = new WorkloadIdentityPoolResource("test-pool", {
			poolId: "my-pool",
			displayName: "My Pool",
		});

		const provider = new GithubActionsWorkloadIdentityProvider("test-provider", {
			repoOwner: "jmmaloney4",
			repoName: "toolbox",
			pool: pool,
			serviceAccountRoles: {
				"roles/viewer": ["my-project"]
			},
		});

		// Verify Service Account Email
		const saEmail = await new Promise<string>(resolve => provider.serviceAccountEmail.apply(resolve));
		expect(saEmail).toBeDefined();
		// Expect sa-{owner}-{repo}-{stack} format (stack is 'test' in mocks usually, or whatever pulumi.getStack() returns)
		// We'll check for the owner/repo part which is most critical
		expect(saEmail).toContain("sa-jmmaloney4-toolbox-");
		expect(saEmail).toMatch(/@test-project\.iam\.gserviceaccount\.com$/);

		// Verify Provider Resource Name
		const providerResource = await new Promise<string>(resolve => provider.workloadIdentityProviderResource.apply(resolve));
		expect(providerResource).toBeDefined();
		// Expect provider-{owner}-{repo}-{stack} format
		expect(providerResource).toContain("provider-jmmaloney4-toolbox-");
	});
});

import * as pulumi from "@pulumi/pulumi";
import { describe, it, expect, beforeAll } from "vitest";

// Mock Pulumi runtime before importing the component
pulumi.runtime.setMocks({
    newResource: function(args: pulumi.runtime.MockResourceArgs): {id: string, state: any} {
        let state = { ...args.inputs };
        if (args.type === "gcp:serviceaccount/account:Account") {
            state = {
                ...state,
                email: "test-sa@test-project.iam.gserviceaccount.com",
                name: "projects/test-project/serviceAccounts/test-sa@test-project.iam.gserviceaccount.com",
            };
        }
        if (args.type === "gcp:iam/workloadIdentityPool:WorkloadIdentityPool") {
            state = {
                ...state,
                workloadIdentityPoolId: "projects/test-project/locations/global/workloadIdentityPools/test-pool",
                name: "projects/test-project/locations/global/workloadIdentityPools/test-pool",
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
    it("should create resources successfully", async () => {
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

        const saEmail = await new Promise<string>(resolve => provider.serviceAccountEmail.apply(resolve));
        expect(saEmail).toBeDefined();
    });
});

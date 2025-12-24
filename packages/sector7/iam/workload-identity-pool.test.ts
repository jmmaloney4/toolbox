import * as pulumi from "@pulumi/pulumi";
import { WorkloadIdentityPoolResource } from "./workload-identity-pool";

// Mock Pulumi runtime
pulumi.runtime.setMocks({
    newResource: function(args: pulumi.runtime.MockResourceArgs): {id: string, state: any} {
        return {
            id: args.name + "_id",
            state: args.inputs,
        };
    },
    call: function(args: pulumi.runtime.MockCallArgs) {
        return args.inputs;
    },
});

describe("WorkloadIdentityPoolResource", () => {
    it("should create a WorkloadIdentityPool with correct properties", async () => {
        const component = new WorkloadIdentityPoolResource("test-pool", {
            poolId: "test-pool-id",
            displayName: "Test Pool",
            description: "Test Description"
        });

        const poolId = await getOutput(component.workloadIdentityPoolId);
        expect(poolId).toBe("test-pool-id");

        const displayName = await getOutput(component.pool.displayName);
        expect(displayName).toBe("Test Pool");
        
        const description = await getOutput(component.pool.description);
        expect(description).toBe("Test Description");
    });

    it("should use default description if not provided", async () => {
         const component = new WorkloadIdentityPoolResource("default-desc-pool", {
            poolId: "default-pool-id",
            displayName: "Default Pool",
        });

        const description = await getOutput(component.pool.description);
        expect(description).toBe("A GCP Workload Identity Pool");
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


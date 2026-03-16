import * as pulumi from "@pulumi/pulumi";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkerSite } from "../workersite/worker-site";

type MockResource = {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
};

const resources: MockResource[] = [];

beforeAll(() => {
	pulumi.runtime.setMocks({
		newResource: (args) => {
			resources.push({
				type: args.type,
				name: args.name,
				inputs: args.inputs as Record<string, unknown>,
			});

			return {
				id: `${args.name}-id`,
				state: args.inputs,
			};
		},
		call: (args) => args.inputs,
	});
});

beforeEach(() => {
	resources.length = 0;
});

function resolveOutput<T>(value: pulumi.Input<T>): Promise<T> {
	return new Promise((resolve) => {
		pulumi.output(value).apply((resolved) => {
			resolve(resolved);
			return resolved;
		});
	});
}

function byName(fragment: string): MockResource[] {
	return resources.filter((resource) => resource.name.includes(fragment));
}

describe("WorkerSite", () => {
	it("creates a worker and custom domains for a public site", async () => {
		const site = new WorkerSite("public-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "public-site",
			domains: ["example.com", "www.example.com"],
			r2Bucket: { bucketName: "public-site-assets" },
		});

		await resolveOutput(site.worker.id);
		await Promise.all(
			site.workerDomains.map((domain) => resolveOutput(domain.id)),
		);

		expect(await resolveOutput(site.workerName)).toBe("public-site");
		expect(await resolveOutput(site.boundDomains)).toEqual([
			"example.com",
			"www.example.com",
		]);
		expect(site.workerDomains).toHaveLength(2);
		expect(site.accessApplications).toHaveLength(0);

		expect(byName("-worker")).toHaveLength(1);
		expect(byName("-domain-")).toHaveLength(2);
	});

	it("creates an access application for each domain and path combination", async () => {
		const site = new WorkerSite("docs-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "docs-site",
			domains: ["docs.example.com", "docs.internal.example.com"],
			r2Bucket: { bucketName: "docs-assets" },
			githubIdentityProviderId: "github-idp",
			githubOrganizations: ["jmmaloney4"],
			paths: [
				{ pattern: "/public/*", access: "public" },
				{ pattern: "/private/*", access: "github-org" },
			],
		});

		await Promise.all(
			site.accessApplications.map((app) => resolveOutput(app.id)),
		);

		expect(site.accessApplications).toHaveLength(4);
		expect(byName("-app-d")).toHaveLength(4);
	});

	it("creates an R2 bucket when requested and binds it to the worker", async () => {
		const site = new WorkerSite("bucket-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "bucket-site",
			domains: ["bucket.example.com"],
			r2Bucket: { bucketName: "bucket-assets", create: true },
		});

		await resolveOutput(site.worker.id);
		await resolveOutput(site.bucket?.id);

		expect(byName("-bucket")).toHaveLength(1);

		const worker = byName("-worker")[0];
		const bindings = worker.inputs.bindings as Array<Record<string, unknown>>;
		const bucketBinding = bindings.find(
			(binding) => binding.name === "R2_BUCKET",
		);

		expect(bucketBinding).toBeDefined();
		expect(bucketBinding?.type).toBe("r2_bucket");
		expect(bucketBinding?.bucketName).toBe("bucket-assets");
	});

	it("validates github-org access requirements", () => {
		expect(
			() =>
				new WorkerSite("invalid-site", {
					accountId: "account-123",
					zoneId: "zone-123",
					name: "invalid-site",
					domains: ["private.example.com"],
					r2Bucket: { bucketName: "private-assets" },
					paths: [{ pattern: "/private/*", access: "github-org" }],
				}),
		).toThrow(
			"githubIdentityProviderId is required when using github-org access",
		);
	});
});

import * as pulumi from "@pulumi/pulumi";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkerSite, type WorkerSiteArgs } from "./worker-site";
import { generateWorkerScript } from "./worker-site-script";

type MockResource = {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
};

const createdResources: MockResource[] = [];

beforeAll(() => {
	pulumi.runtime.setMocks({
		newResource: (args) => {
			createdResources.push({
				type: args.type,
				name: args.name,
				inputs: args.inputs,
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
	createdResources.length = 0;
});

function baseArgs(): WorkerSiteArgs {
	return {
		accountId: "acc-123",
		zoneId: "zone-123",
		name: "docs-site",
		domains: ["docs.example.com"],
		r2Bucket: {
			bucketName: "docs-assets",
		},
		paths: [{ pattern: "/public/*", access: "public" }],
	};
}

function resourcesFor(componentName: string): MockResource[] {
	return createdResources.filter((resource) =>
		resource.name.startsWith(`${componentName}-`),
	);
}

function countResources(
	resources: MockResource[],
	typeNames: string[],
): number {
	return resources.filter((resource) =>
		typeNames.some((typeName) => resource.type.includes(typeName)),
	).length;
}

function outputValue<T>(output: pulumi.Output<T>): Promise<T> {
	return new Promise((resolve) => {
		output.apply((value) => {
			resolve(value);
			return value;
		});
	});
}

async function settleSite(site: WorkerSite): Promise<void> {
	await outputValue(
		pulumi.all([
			site.worker.id,
			...site.workerDomains.map((domain) => domain.id),
			...site.dnsRecords.map((record) => record.id),
			...site.accessApplications.map((app) => app.id),
		]),
	);
}

describe("WorkerSite", () => {
	it("creates expected resources for public-only configuration", async () => {
		const componentName = "public-site";
		const site = new WorkerSite(componentName, baseArgs());
		await settleSite(site);
		const resources = resourcesFor(componentName);

		expect(countResources(resources, ["WorkersScript"])).toBe(1);
		expect(
			countResources(resources, ["WorkerDomain", "WorkersCustomDomain"]),
		).toBe(1);
		expect(countResources(resources, ["Record", "DnsRecord"])).toBe(1);
		expect(
			countResources(resources, [
				"ZeroTrustAccessApplication",
				"AccessApplication",
			]),
		).toBe(1);

		const workerResource = resources.find((r) =>
			r.type.includes("WorkersScript"),
		);
		expect(workerResource?.inputs.scriptName).toBe("docs-site");
	});

	it("throws when github-org access is used without GitHub provider id", () => {
		expect(
			() =>
				new WorkerSite("restricted-site", {
					...baseArgs(),
					paths: [{ pattern: "/private/*", access: "github-org" }],
				}),
		).toThrow(
			"githubIdentityProviderId is required when using github-org access",
		);
	});

	it("skips DNS record creation when manageDns is false", async () => {
		const componentName = "no-dns-site";
		const site = new WorkerSite(componentName, {
			...baseArgs(),
			manageDns: false,
		});
		await settleSite(site);
		const resources = resourcesFor(componentName);

		expect(countResources(resources, ["Record", "DnsRecord"])).toBe(0);
		expect(
			countResources(resources, ["WorkerDomain", "WorkersCustomDomain"]),
		).toBe(1);
	});

	it("creates an R2 bucket when r2Bucket.create is true", async () => {
		const componentName = "create-bucket-site";
		const site = new WorkerSite(componentName, {
			...baseArgs(),
			r2Bucket: {
				bucketName: "created-assets",
				create: true,
			},
		});
		await settleSite(site);
		const resources = resourcesFor(componentName);

		expect(countResources(resources, ["R2Bucket"])).toBe(1);

		const workerResource = resources.find((r) =>
			r.type.includes("WorkersScript"),
		);
		const r2Binding = (
			workerResource?.inputs.bindings as Array<Record<string, unknown>>
		).find((binding) => binding.name === "R2_BUCKET");

		expect(r2Binding).toBeDefined();
		expect(r2Binding?.bucketName).toBeDefined();
	});

	it("does not create an R2 bucket when r2Bucket.create is false or omitted", async () => {
		const componentName = "existing-bucket-site";
		const site = new WorkerSite(componentName, {
			...baseArgs(),
			r2Bucket: {
				bucketName: "existing-assets",
				create: false,
			},
		});
		await settleSite(site);
		const resources = resourcesFor(componentName);

		expect(countResources(resources, ["R2Bucket"])).toBe(0);
	});

	it("creates one WorkerDomain and one DNS record per domain", async () => {
		const componentName = "multi-domain-site";
		const site = new WorkerSite(componentName, {
			...baseArgs(),
			domains: ["a.example.com", "b.example.com"],
		});
		await settleSite(site);
		const resources = resourcesFor(componentName);

		expect(
			countResources(resources, ["WorkerDomain", "WorkersCustomDomain"]),
		).toBe(2);
		expect(countResources(resources, ["Record", "DnsRecord"])).toBe(2);
	});

	it("creates one AccessApplication per (domain x path)", async () => {
		const componentName = "multi-path-site";
		const site = new WorkerSite(componentName, {
			...baseArgs(),
			domains: ["a.example.com", "b.example.com"],
			paths: [
				{ pattern: "/blog/*", access: "public" },
				{ pattern: "/research/*", access: "public" },
			],
		});
		await settleSite(site);
		const resources = resourcesFor(componentName);

		expect(
			countResources(resources, [
				"ZeroTrustAccessApplication",
				"AccessApplication",
			]),
		).toBe(4);
	});
});

describe("generateWorkerScript", () => {
	it("returns a non-empty worker script with expected markers", () => {
		const script = generateWorkerScript("R2_BUCKET");

		expect(script.length).toBeGreaterThan(0);
		expect(script).toContain("R2_BUCKET");
		expect(script).toContain("CACHE_TTL_SECONDS");
		expect(script).toContain("caches.default");
		expect(script).toContain("index.html");
	});

	it("includes prefix handling when prefix is provided", () => {
		const script = generateWorkerScript("R2_BUCKET", "docs");

		expect(script).toContain("objectKey = 'docs/' + objectKey;");
	});
});

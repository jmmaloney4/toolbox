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
			const state = args.type.includes("AccountToken")
				? { ...args.inputs, value: "mock-account-token-value" }
				: args.inputs;

			resources.push({
				type: args.type,
				name: args.name,
				inputs: state as Record<string, unknown>,
			});

			return {
				id: `${args.name}-id`,
				state,
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
			resolve(resolved as T);
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

		const worker = byName("-worker")[0];
		expect(worker.inputs.observability).toEqual({
			enabled: true,
			headSamplingRate: 0.1,
			logs: {
				enabled: true,
				headSamplingRate: 0.1,
				invocationLogs: true,
				destinations: ["cloudflare"],
				persist: true,
			},
		});
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

	it("creates bypass policy for bypass access paths", async () => {
		const site = new WorkerSite("bypass-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "bypass-site",
			domains: ["bypass.example.com"],
			r2Bucket: { bucketName: "bypass-assets" },
			paths: [
				{ pattern: "/", access: "bypass" },
				{ pattern: "/styles.css", access: "bypass" },
			],
		});

		await Promise.all(
			site.accessApplications.map((app) => resolveOutput(app.id)),
		);

		expect(site.accessApplications).toHaveLength(2);

		const apps = byName("bypass-site-app-d");
		expect(apps).toHaveLength(2);

		for (const app of apps) {
			const policies = app.inputs.policies as Array<Record<string, unknown>>;
			expect(policies).toHaveLength(1);
			expect(policies[0].decision).toBe("bypass");
			expect(policies[0].name).toBe("Bypass for public path");
			const includes = policies[0].includes as Array<Record<string, unknown>>;
			expect(includes).toEqual([{ everyone: {} }]);
		}
	});

	it("uses bypass decision for bypass paths and allow for other paths", async () => {
		const site = new WorkerSite("mixed-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "mixed-site",
			domains: ["mixed.example.com"],
			r2Bucket: { bucketName: "mixed-assets" },
			githubIdentityProviderId: "github-idp",
			githubOrganizations: ["my-org"],
			paths: [
				{ pattern: "/favicon.ico", access: "bypass" },
				{ pattern: "/public/*", access: "public" },
				{ pattern: "/private/*", access: "github-org" },
			],
		});

		await Promise.all(
			site.accessApplications.map((app) => resolveOutput(app.id)),
		);

		expect(site.accessApplications).toHaveLength(3);

		const apps = byName("mixed-site-app-d");
		expect(apps).toHaveLength(3);

		// Find apps by path index: p0=bypass, p1=public, p2=github-org
		const bypassApp = apps.find((a) => a.name.includes("-p0"));
		const publicApp = apps.find((a) => a.name.includes("-p1"));
		const privateApp = apps.find((a) => a.name.includes("-p2"));

		expect(bypassApp).toBeDefined();
		expect(publicApp).toBeDefined();
		expect(privateApp).toBeDefined();

		if (!bypassApp || !publicApp || !privateApp) {
			throw new Error(
				"Expected bypass, public, and private access apps to exist",
			);
		}

		const bypassPolicies = bypassApp.inputs.policies as Array<
			Record<string, unknown>
		>;
		expect(bypassPolicies[0].decision).toBe("bypass");
		expect(bypassPolicies[0].name).toBe("Bypass for public path");

		const publicPolicies = publicApp.inputs.policies as Array<
			Record<string, unknown>
		>;
		expect(publicPolicies[0].decision).toBe("allow");
		expect(publicPolicies[0].name).toBe("Allow everyone");

		const privatePolicies = privateApp.inputs.policies as Array<
			Record<string, unknown>
		>;
		expect(privatePolicies[0].decision).toBe("allow");
		expect(privatePolicies[0].name).toBe("GitHub org members");
	});

	it("allows bypass paths without githubIdentityProviderId", async () => {
		// bypass paths should not require github config
		const site = new WorkerSite("bypass-only-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "bypass-only-site",
			domains: ["bypass-only.example.com"],
			r2Bucket: { bucketName: "bypass-only-assets" },
			paths: [
				{ pattern: "/", access: "bypass" },
				{ pattern: "/robots.txt", access: "bypass" },
			],
		});
		await resolveOutput(site.worker.id);
		await Promise.all(
			site.accessApplications.map((app) => resolveOutput(app.id)),
		);
		expect(site.accessApplications).toHaveLength(2);
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
			"githubIdentityProviderId or githubOAuthConfig is required when using github-org access",
		);
	});

	it("rejects both githubOAuthConfig and githubIdentityProviderId", () => {
		expect(
			() =>
				new WorkerSite("conflict-site", {
					accountId: "account-123",
					zoneId: "zone-123",
					name: "conflict-site",
					domains: ["conflict.example.com"],
					r2Bucket: { bucketName: "conflict-assets" },
					githubIdentityProviderId: "manual-idp-id",
					githubOAuthConfig: {
						clientId: "Ov23li",
						clientSecret: "secret",
					},
					paths: [{ pattern: "/*", access: "github-org" }],
				}),
		).toThrow(
			"githubOAuthConfig and githubIdentityProviderId are mutually exclusive",
		);
	});

	it("requires zoneId for WorkersCustomDomain bindings", () => {
		expect(
			() =>
				new WorkerSite("missing-zone-site", {
					accountId: "account-123",
					name: "missing-zone-site",
					domains: ["example.com"],
					r2Bucket: { bucketName: "missing-zone-assets" },
				} as unknown as ConstructorParameters<typeof WorkerSite>[1]),
		).toThrow("zoneId is required because WorkersCustomDomain depends on it");
	});

	it("allows overriding worker observability settings", async () => {
		const site = new WorkerSite("observability-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "observability-site",
			domains: ["obs.example.com"],
			r2Bucket: { bucketName: "observability-assets" },
			observability: {
				headSamplingRate: 1,
				logs: {
					headSamplingRate: 1,
					persist: false,
				},
			},
		});

		await resolveOutput(site.worker.id);

		const worker = byName("-worker")[0];
		expect(worker.inputs.observability).toEqual({
			enabled: true,
			headSamplingRate: 1,
			logs: {
				enabled: true,
				headSamplingRate: 1,
				invocationLogs: true,
				destinations: ["cloudflare"],
				persist: false,
			},
		});
	});

	it("cascades defaults when observability is disabled", async () => {
		const site = new WorkerSite("disabled-obs-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "disabled-obs-site",
			domains: ["disabled.example.com"],
			r2Bucket: { bucketName: "disabled-obs-assets" },
			observability: {
				enabled: false,
			},
		});

		await resolveOutput(site.worker.id);

		const worker = byName("-worker")[0];
		expect(worker.inputs.observability).toEqual({
			enabled: false,
			headSamplingRate: 0.1,
			logs: {
				enabled: false,
				headSamplingRate: 0.1,
				invocationLogs: false,
				destinations: ["cloudflare"],
				persist: false,
			},
		});
	});

	it("cascades defaults when logs are disabled but observability is enabled", async () => {
		const site = new WorkerSite("no-logs-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "no-logs-site",
			domains: ["nologs.example.com"],
			r2Bucket: { bucketName: "no-logs-assets" },
			observability: {
				enabled: true,
				logs: {
					enabled: false,
				},
			},
		});

		await resolveOutput(site.worker.id);

		const worker = byName("-worker")[0];
		expect(worker.inputs.observability).toEqual({
			enabled: true,
			headSamplingRate: 0.1,
			logs: {
				enabled: false,
				headSamplingRate: 0.1,
				invocationLogs: false,
				destinations: ["cloudflare"],
				persist: false,
			},
		});
	});

	it("auto-creates a GitHub Identity Provider when githubOAuthConfig is provided", async () => {
		const site = new WorkerSite("oauth-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "oauth-site",
			domains: ["oauth.example.com"],
			r2Bucket: { bucketName: "oauth-assets" },
			githubOAuthConfig: {
				clientId: "Ov23li-test",
				clientSecret: "test-secret",
			},
			githubOrganizations: ["my-org"],
			paths: [
				{ pattern: "/", access: "bypass" },
				{ pattern: "/private/*", access: "github-org" },
			],
		});

		await resolveOutput(site.worker.id);
		await Promise.all(
			site.accessApplications.map((app) => resolveOutput(app.id)),
		);

		// Verify the IDP resource was created
		expect(site.githubIdp).toBeDefined();
		const idps = byName("-github-idp");
		expect(idps).toHaveLength(1);
		expect(idps[0].inputs.type).toBe("github");
		expect(idps[0].inputs.config).toEqual({
			clientId: "Ov23li-test",
			clientSecret: "test-secret",
		});
		expect(idps[0].inputs.accountId).toBe("account-123");

		// Verify Access applications were created (2 paths x 1 domain = 2)
		expect(site.accessApplications).toHaveLength(2);

		// Verify github-org path uses the auto-created IDP
		const privateApp = byName("oauth-site-app-d").find((a) =>
			a.name.includes("-p1"),
		);
		expect(privateApp).toBeDefined();
	});

	it("does not create an IDP when githubOAuthConfig is not provided", async () => {
		const site = new WorkerSite("no-idp-site", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "no-idp-site",
			domains: ["no-idp.example.com"],
			r2Bucket: { bucketName: "no-idp-assets" },
			paths: [{ pattern: "/", access: "bypass" }],
		});

		await resolveOutput(site.worker.id);

		expect(site.githubIdp).toBeUndefined();
		expect(byName("-github-idp")).toHaveLength(0);
	});
});

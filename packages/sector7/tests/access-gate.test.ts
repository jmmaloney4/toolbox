import * as pulumi from "@pulumi/pulumi";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccessGate } from "../access/access-gate";

type MockResource = {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
};

const resources: MockResource[] = [];

beforeAll(() => {
	pulumi.runtime.setMocks({
		newResource: (args) => {
			const state = args.inputs;

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

describe("AccessGate", () => {
	it("creates an access application for each domain and path combination", async () => {
		const gate = new AccessGate("multi-domain", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "docs-site",
			domains: ["docs.example.com", "docs.internal.example.com"],
			paths: [
				{ pattern: "/public/*", access: "public" },
				{ pattern: "/private/*", access: "github-org" },
			],
			githubIdentityProviderId: "github-idp",
			githubOrganizations: ["jmmaloney4"],
		});

		await Promise.all(
			gate.accessApplications.map((app) => resolveOutput(app.id)),
		);

		expect(gate.accessApplications).toHaveLength(4);
		expect(byName("-app-d")).toHaveLength(4);
	});

	it("creates bypass policy for bypass access paths", async () => {
		const gate = new AccessGate("bypass-test", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "bypass-site",
			domains: ["bypass.example.com"],
			paths: [
				{ pattern: "/", access: "bypass" },
				{ pattern: "/styles.css", access: "bypass" },
			],
		});

		await Promise.all(
			gate.accessApplications.map((app) => resolveOutput(app.id)),
		);

		expect(gate.accessApplications).toHaveLength(2);

		const apps = byName("bypass-test-app-d");
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
		const gate = new AccessGate("mixed-test", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "mixed-site",
			domains: ["mixed.example.com"],
			paths: [
				{ pattern: "/favicon.ico", access: "bypass" },
				{ pattern: "/public/*", access: "public" },
				{ pattern: "/private/*", access: "github-org" },
			],
			githubIdentityProviderId: "github-idp",
			githubOrganizations: ["my-org"],
		});

		await Promise.all(
			gate.accessApplications.map((app) => resolveOutput(app.id)),
		);

		expect(gate.accessApplications).toHaveLength(3);

		const apps = byName("mixed-test-app-d");
		expect(apps).toHaveLength(3);

		const bypassApp = apps.find((a) => a.name.includes("-p0"));
		const publicApp = apps.find((a) => a.name.includes("-p1"));
		const privateApp = apps.find((a) => a.name.includes("-p2"));

		expect(bypassApp).toBeDefined();
		expect(publicApp).toBeDefined();
		expect(privateApp).toBeDefined();

		if (!bypassApp || !publicApp || !privateApp) {
			throw new Error("Expected all access apps to exist");
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

	it("auto-creates a GitHub Identity Provider when githubOAuthConfig is provided", async () => {
		const gate = new AccessGate("oauth-test", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "oauth-site",
			domains: ["oauth.example.com"],
			paths: [
				{ pattern: "/", access: "bypass" },
				{ pattern: "/private/*", access: "github-org" },
			],
			githubOAuthConfig: {
				clientId: "Ov23li-test",
				clientSecret: "test-secret",
			},
			githubOrganizations: ["my-org"],
		});

		await Promise.all([
			...gate.accessApplications.map((app) => resolveOutput(app.id)),
			gate.githubIdp ? resolveOutput(gate.githubIdp.id) : Promise.resolve(),
		]);

		expect(gate.githubIdp).toBeDefined();
		const idps = byName("-github-idp");
		expect(idps).toHaveLength(1);
		expect(idps[0].inputs.type).toBe("github");
		expect(idps[0].inputs.config).toEqual({
			clientId: "Ov23li-test",
			clientSecret: "test-secret",
		});
		expect(idps[0].inputs.accountId).toBe("account-123");

		expect(gate.accessApplications).toHaveLength(2);
	});

	it("does not create an IDP when githubOAuthConfig is not provided", async () => {
		const gate = new AccessGate("no-idp-test", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "no-idp-site",
			domains: ["no-idp.example.com"],
			paths: [{ pattern: "/", access: "bypass" }],
		});

		await Promise.all(
			gate.accessApplications.map((app) => resolveOutput(app.id)),
		);

		expect(gate.githubIdp).toBeUndefined();
		expect(byName("-github-idp")).toHaveLength(0);
	});

	it("validates github-org access requirements", () => {
		expect(
			() =>
				new AccessGate("invalid-test", {
					accountId: "account-123",
					zoneId: "zone-123",
					name: "invalid-site",
					domains: ["private.example.com"],
					paths: [{ pattern: "/private/*", access: "github-org" }],
				}),
		).toThrow(
			"githubIdentityProviderId or githubOAuthConfig is required when using github-org access",
		);
	});

	it("rejects both githubOAuthConfig and githubIdentityProviderId", () => {
		expect(
			() =>
				new AccessGate("conflict-test", {
					accountId: "account-123",
					zoneId: "zone-123",
					name: "conflict-site",
					domains: ["conflict.example.com"],
					paths: [{ pattern: "/*", access: "github-org" }],
					githubIdentityProviderId: "manual-idp-id",
					githubOAuthConfig: {
						clientId: "Ov23li",
						clientSecret: "secret",
					},
					githubOrganizations: ["my-org"],
				}),
		).toThrow(
			"githubOAuthConfig and githubIdentityProviderId are mutually exclusive",
		);
	});

	it("rejects empty domains", () => {
		expect(
			() =>
				new AccessGate("no-domains-test", {
					accountId: "account-123",
					zoneId: "zone-123",
					name: "no-domains",
					domains: [],
					paths: [{ pattern: "/", access: "bypass" }],
				}),
		).toThrow("AccessGate requires at least one domain");
	});

	it("rejects empty paths", () => {
		expect(
			() =>
				new AccessGate("no-paths-test", {
					accountId: "account-123",
					zoneId: "zone-123",
					name: "no-paths",
					domains: ["example.com"],
					paths: [],
				}),
		).toThrow("AccessGate requires at least one path");
	});

	it("uses custom session duration and type when provided", async () => {
		const gate = new AccessGate("custom-test", {
			accountId: "account-123",
			zoneId: "zone-123",
			name: "custom-site",
			domains: ["custom.example.com"],
			paths: [{ pattern: "/*", access: "public" }],
			sessionDuration: "12h",
			type: "saas",
		});

		await Promise.all(
			gate.accessApplications.map((app) => resolveOutput(app.id)),
		);

		const apps = byName("custom-test-app-d");
		expect(apps).toHaveLength(1);
		expect(apps[0].inputs.sessionDuration).toBe("12h");
		expect(apps[0].inputs.type).toBe("saas");
	});
});

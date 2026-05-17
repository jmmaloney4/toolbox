import * as pulumi from "@pulumi/pulumi";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LiteLLMApiKey, LiteLLMTeam } from "../litellm/admin.ts";
import { LiteLLMProxy } from "../litellm/litellm-proxy.ts";

type MockResource = {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
};

const resources: MockResource[] = [];

beforeAll(() => {
	pulumi.runtime.setMocks({
		newResource: (args) => {
			const state = { ...(args.inputs as Record<string, unknown>) };
			if (args.type === "random:index/randomPassword:RandomPassword") {
				state.result =
					args.name === "personal-coding-key-secret"
						? "generated-api-key"
						: "generated-master-key";
			}
			if (args.type === "command:local:Command") {
				state.stdout = `${args.name}-stdout`;
			}
			resources.push({
				type: args.type,
				name: args.name,
				inputs: state,
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

function findResource(name: string): MockResource | undefined {
	return resources.find((resource) => resource.name === name);
}

async function resolveRecord(
	value: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
	const resolved = await resolveOutput(value ?? {});
	if (
		resolved &&
		typeof resolved === "object" &&
		"value" in resolved &&
		typeof resolved.value === "object" &&
		resolved.value !== null
	) {
		return resolved.value as Record<string, unknown>;
	}
	return resolved;
}

describe("LiteLLMProxy", () => {
	it("creates namespace, secrets, configmap, deployment, and service", async () => {
		const proxy = new LiteLLMProxy("team-proxy", {
			namespace: "litellm-prod",
			providers: {
				anthropic: { apiKey: pulumi.secret("anthropic-secret") },
				openai: {
					apiKey: pulumi.secret("openai-secret"),
					apiBase: "https://api.openai.example/v1",
				},
			},
			deployments: [
				{
					id: "anthropic-smart",
					provider: "anthropic",
					providerModel: "anthropic/claude-sonnet-4-20250514",
					mode: "chat",
				},
				{
					id: "openai-fast",
					provider: "openai",
					providerModel: "openai/gpt-4o-mini",
					mode: "chat",
				},
			],
			modelGroups: [
				{
					name: "smart",
					deploymentIds: ["anthropic-smart"],
					fallbacks: ["fast"],
				},
				{ name: "fast", deploymentIds: ["openai-fast"] },
			],
			databaseUrl: pulumi.secret(
				"postgres://db-user:real-pass@db.internal/litellm",
			),
		});

		await Promise.all([
			resolveOutput(proxy.proxyUrl),
			resolveOutput(proxy.masterKey),
			resolveOutput(proxy.configYaml),
			resolveOutput(proxy.providerSecret.id),
			resolveOutput(proxy.runtimeSecret.id),
			resolveOutput(proxy.configMap.id),
			resolveOutput(proxy.deployment.id),
			resolveOutput(proxy.service.id),
		]);

		expect(await resolveOutput(proxy.proxyUrl)).toBe(
			"http://team-proxy.litellm-prod.svc.cluster.local:4000",
		);
		expect(await resolveOutput(proxy.masterKey)).toBe("generated-master-key");

		const namespace = findResource("team-proxy-ns");
		expect(namespace?.type).toBe("kubernetes:core/v1:Namespace");

		const providerSecret = findResource("team-proxy-providers");
		expect(providerSecret?.type).toBe("kubernetes:core/v1:Secret");
		const providerSecretData = providerSecret?.inputs.stringData as {
			value: Record<string, string>;
		};
		expect(providerSecretData.value).toEqual({
			anthropic_api_key: "anthropic-secret",
			openai_api_key: "openai-secret",
		});

		const runtimeSecret = findResource("team-proxy-runtime");
		const runtimeSecretData = runtimeSecret?.inputs.stringData as {
			value: Record<string, string>;
		};
		expect(runtimeSecretData.value).toEqual({
			LITELLM_MASTER_KEY: "generated-master-key",
			DATABASE_URL: "postgres://db-user:real-pass@db.internal/litellm",
		});

		const configYaml = await resolveOutput(proxy.configYaml);
		expect(configYaml).toContain("model_name: smart");
		expect(configYaml).toContain("os.environ/ANTHROPIC_API_KEY");
		expect(configYaml).toContain("database_url: os.environ/DATABASE_URL");
		expect(configYaml).not.toContain("real-pass");

		const deployment = findResource("team-proxy-deployment");
		expect(deployment?.type).toBe("kubernetes:apps/v1:Deployment");
		expect(deployment?.inputs.metadata).toMatchObject({
			name: "team-proxy",
			namespace: "litellm-prod",
		});

		const service = findResource("team-proxy-service");
		expect(service?.type).toBe("kubernetes:core/v1:Service");
	});

	it("can skip namespace creation", async () => {
		const proxy = new LiteLLMProxy("shared-proxy", {
			createNamespace: false,
			namespace: "shared-services",
			providers: { anthropic: { apiKey: pulumi.secret("anthropic-secret") } },
			deployments: [
				{
					id: "anthropic-smart",
					provider: "anthropic",
					providerModel: "anthropic/claude-sonnet-4-20250514",
				},
			],
			modelGroups: [{ name: "smart", deploymentIds: ["anthropic-smart"] }],
			databaseUrl: pulumi.secret(
				"postgres://db-user:***@db.internal/litellm",
			),
		});

		await resolveOutput(proxy.proxyUrl);

		expect(findResource("shared-proxy-ns")).toBeUndefined();
		expect(await resolveOutput(proxy.namespace)).toBe("shared-services");
	});

	it("creates admin command resources for teams and api keys", async () => {
		const team = new LiteLLMTeam("personal-team", {
			proxyNamespace: "litellm-prod",
			masterKey: pulumi.secret("master-key"),
			teamAlias: "Personal",
			teamId: "team-personal",
			models: ["coding", "cheap"],
			maxBudget: 250,
			budgetDuration: "30d",
			tags: ["personal"],
			metadata: { owner: "jack" },
		});
		const apiKey = new LiteLLMApiKey("personal-coding-key", {
			proxyNamespace: "litellm-prod",
			masterKey: pulumi.secret("master-key"),
			keyAlias: "personal-coding",
			teamId: "team-personal",
			models: ["coding"],
			aliases: { default: "coding" },
			metadata: { owner: "jack" },
			tags: ["personal"],
		});

		expect(await resolveOutput(team.teamId)).toBe("team-personal");
		expect(await resolveOutput(apiKey.key)).toBe("sk-generated-api-key");
		expect(await resolveOutput(apiKey.tokenId)).toBe(
			"personal-coding-key-key-stdout",
		);

		const teamCommand = findResource("personal-team-team");
		expect(teamCommand?.type).toBe("command:local:Command");
		const teamEnvironment = await resolveRecord(
			teamCommand?.inputs.environment as Record<string, unknown> | undefined,
		);
		expect(teamEnvironment).toMatchObject({
			LITELLM_PROXY_NAMESPACE: "litellm-prod",
			LITELLM_TEAM_ALIAS: "Personal",
			LITELLM_TEAM_ID: "team-personal",
			LITELLM_TEAM_MODELS_JSON: '["coding","cheap"]',
			LITELLM_TEAM_MAX_BUDGET: "250",
		});

		const keyCommand = findResource("personal-coding-key-key");
		expect(keyCommand?.type).toBe("command:local:Command");
		const keyEnvironment = await resolveRecord(
			keyCommand?.inputs.environment as Record<string, unknown> | undefined,
		);
		expect(keyEnvironment).toMatchObject({
			LITELLM_KEY_ALIAS: "personal-coding",
			LITELLM_KEY_TEAM_ID: "team-personal",
			LITELLM_KEY_MODELS_JSON: '["coding"]',
			LITELLM_KEY_ALIASES_JSON: '{"default":"coding"}',
		});
	});
});

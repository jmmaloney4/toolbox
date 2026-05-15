import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { generateLiteLLMConfig } from "../litellm/config.ts";

describe("generateLiteLLMConfig", () => {
	it("generates grouped model config with fallbacks and env-based secrets", () => {
		const generated = generateLiteLLMConfig({
			providers: {
				anthropic: { apiKey: "anthropic-secret" },
				openai: { apiKey: "openai-secret", apiBase: "https://api.openai.example/v1" },
			},
			deployments: [
				{
					id: "anthropic-smart",
					modelName: "smart",
					provider: "anthropic",
					providerModel: "anthropic/claude-sonnet-4-20250514",
					mode: "chat",
					accessGroups: ["premium"],
					maxInputTokens: 200000,
				},
				{
					id: "openai-fast",
					modelName: "fast",
					provider: "openai",
					providerModel: "openai/gpt-4o-mini",
					mode: "chat",
					rpm: 500,
					tpm: 200000,
				},
			],
			modelGroups: [
				{
					name: "smart",
					deploymentIds: ["anthropic-smart"],
					fallbacks: ["fast"],
					contextWindowFallbacks: ["long-context"],
					accessGroups: ["core"],
				},
				{
					name: "fast",
					deploymentIds: ["openai-fast"],
				},
				{
					name: "long-context",
					deploymentIds: ["anthropic-smart"],
				},
			],
			router: {
				defaultFallbacks: ["smart"],
				retryPolicy: { RateLimitErrorRetries: 3 },
			},
			governance: {
				maxBudget: 500,
				budgetDuration: "30d",
			},
		});

		expect(generated.providerEnvVars).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
		expect(generated.configYaml).not.toContain("anthropic-secret");
		expect(generated.configYaml).not.toContain("openai-secret");

		const parsed = parse(generated.configYaml) as Record<string, unknown>;
		const modelList = parsed.model_list as Array<Record<string, unknown>>;
		expect(modelList).toHaveLength(3);
		expect(modelList[0].model_name).toBe("smart");
		expect((modelList[0].litellm_params as Record<string, unknown>).api_key).toBe("os.environ/ANTHROPIC_API_KEY");
		expect((modelList[0].model_info as Record<string, unknown>).access_groups).toEqual(["premium", "core"]);

		const routerSettings = parsed.router_settings as Record<string, unknown>;
		expect(routerSettings.routing_strategy).toBe("cost-based-routing");
		expect(routerSettings.fallbacks).toEqual([{ smart: ["fast"] }]);
		expect(routerSettings.context_window_fallbacks).toEqual([{ smart: ["long-context"] }]);
		expect(routerSettings.default_fallbacks).toEqual(["smart"]);

		const generalSettings = parsed.general_settings as Record<string, unknown>;
		expect(generalSettings.database_url).toBe("os.environ/DATABASE_URL");
		expect(generalSettings.master_key).toBe("os.environ/LITELLM_MASTER_KEY");
	});

	it("rejects missing deployment references and multi-replica without redis", () => {
		expect(() =>
			generateLiteLLMConfig({
				providers: { anthropic: { apiKey: "secret" } },
				deployments: [
					{
						id: "dep-1",
						modelName: "smart",
						provider: "anthropic",
						providerModel: "anthropic/claude-sonnet-4-20250514",
					},
				],
				modelGroups: [{ name: "smart", deploymentIds: ["missing-deployment"] }],
			}),
		).toThrow(/missing deployment/i);

		expect(() =>
			generateLiteLLMConfig({
				providers: { anthropic: { apiKey: "secret" } },
				deployments: [
					{
						id: "dep-1",
						modelName: "smart",
						provider: "anthropic",
						providerModel: "anthropic/claude-sonnet-4-20250514",
					},
				],
				modelGroups: [{ name: "smart", deploymentIds: ["dep-1"] }],
				replicas: 2,
			}),
		).toThrow(/replicas > 1 require redis/i);
	});
});

import * as pulumi from "@pulumi/pulumi";
import { describe, expect, it } from "vitest";
import { requireMixedConfig } from "../pulumi-config/index.ts";

type FakeConfig = Pick<pulumi.Config, "requireObject" | "requireSecret">;

type ProviderConfig = {
	provider: string;
	apiKey: string;
};

function fakeConfig(args: {
	objects: Record<string, unknown>;
	secrets: Record<string, string>;
}): pulumi.Config {
	const config: FakeConfig = {
		requireObject: <T>(key: string): T => {
			if (!(key in args.objects)) {
				throw new Error(`missing object ${key}`);
			}
			return args.objects[key] as T;
		},
		requireSecret: (key: string) => {
			if (!(key in args.secrets)) {
				throw new Error(`missing secret ${key}`);
			}
			return pulumi.secret(args.secrets[key]);
		},
	};
	return config as pulumi.Config;
}

async function resolveOutput<T>(value: pulumi.Input<T>): Promise<T> {
	return new Promise((resolve) => {
		pulumi.output(value).apply((resolved) => {
			resolve(resolved as T);
			return resolved;
		});
		});
}

describe("requireMixedConfig", () => {
	it("reads map-shaped config with plain and secret fields", async () => {
		const config = fakeConfig({
			objects: {
				providers: {
					personal: { provider: "zai" },
					cavinsresearch: { provider: "zai" },
				},
			},
			secrets: {
				"providers.personal.apiKey": "personal-secret",
				"providers.cavinsresearch.apiKey": "research-secret",
			},
		});

		const providers = requireMixedConfig<ProviderConfig, ["apiKey"]>(
			config,
			"providers",
			{ shape: "map", secretFields: ["apiKey"] },
		);

		expect(providers.personal.provider).toBe("zai");
		expect(providers.cavinsresearch.provider).toBe("zai");
		expect(await resolveOutput(providers.personal.apiKey)).toBe(
			"personal-secret",
		);
		expect(await resolveOutput(providers.cavinsresearch.apiKey)).toBe(
			"research-secret",
		);
	});

	it("reads flat secret maps", async () => {
		const config = fakeConfig({
			objects: {
				tokens: {
					ghcr: "placeholder",
					langfuse: "placeholder",
				},
			},
			secrets: {
				"tokens.ghcr": "ghcr-secret",
				"tokens.langfuse": "langfuse-secret",
			},
		});

		const tokens = requireMixedConfig(config, "tokens", {
			shape: "flatSecrets",
		});

		expect(await resolveOutput(tokens.ghcr)).toBe("ghcr-secret");
		expect(await resolveOutput(tokens.langfuse)).toBe("langfuse-secret");
	});
});

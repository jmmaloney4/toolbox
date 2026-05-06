import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NixImage } from "../nix-image/nix-image";

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

			// For command.local.Command, simulate stdout with DIGEST_OUTPUT marker
			if (args.type === "command:local:Command") {
				const create = state.create as string | undefined;

				if (create?.includes("nix-image-build-push.sh")) {
					// Build mode: simulate script output
					(state as Record<string, unknown>).stdout =
						"=== Pushed registry/example:dev ===\n=== Digest: sha256:abc123def456 ===\nDIGEST_OUTPUT:sha256:abc123def456\n";
				} else if (create?.includes("inspect")) {
					// Resolve mode: simulate skopeo inspect --format output
					(state as Record<string, unknown>).stdout =
						"sha256:abc123def456\n";
				}
			}

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

describe("NixImage", () => {
	it("creates a Command resource for build mode with correct env vars", async () => {
		const img = new NixImage("test-build", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "dev",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
		});

		await resolveOutput(img.digest);

		const cmds = byName("test-build-build-push");
		expect(cmds).toHaveLength(1);

		const cmd = cmds[0];
		expect(cmd.type).toBe("command:local:Command");
		expect(cmd.inputs.environment).toEqual({
			NIX_ATTR: "packages.x86_64-linux.my-image",
			IMAGE_NAME: "my-image",
			IMAGE_TAG: "dev",
			ARTIFACT_REGISTRY_URL: "us-east1-docker.pkg.dev/my-project/my-repo",
			AUTH_MODE: "gcloud",
			SCRIPT_MODE: "build",
			REPO_ROOT: "/home/user/my-repo",
			RESULT_LINK: "result-test-build",
			COMMAND_LOG_STEM: ".pulumi/command-logs/test-build",
		});
	});

	it("creates a Command resource for resolve mode that inspects the image", async () => {
		const img = new NixImage("test-resolve", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "v1.0.0",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
			mode: "resolve",
		});

		await resolveOutput(img.digest);

		const cmds = byName("test-resolve-resolve");
		expect(cmds).toHaveLength(1);

		const cmd = cmds[0];
		expect(cmd.type).toBe("command:local:Command");

		const createCmd = cmd.inputs.create as string;
		expect(createCmd).toContain("nix-image-build-push.sh");
		expect(cmd.inputs.environment).toMatchObject({
			IMAGE_NAME: "my-image",
			IMAGE_TAG: "v1.0.0",
			ARTIFACT_REGISTRY_URL: "us-east1-docker.pkg.dev/my-project/my-repo",
			AUTH_MODE: "gcloud",
			SCRIPT_MODE: "resolve",
			COMMAND_LOG_STEM: ".pulumi/command-logs/test-resolve",
		});
	});

	it("parses DIGEST_OUTPUT marker from stdout correctly", async () => {
		const img = new NixImage("test-digest", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "dev",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
		});

		const digest = await resolveOutput(img.digest);
		expect(digest).toBe("sha256:abc123def456");
	});

	it("produces correct imageRef with digest", async () => {
		const img = new NixImage("test-ref", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "dev",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
		});

		const imageRef = await resolveOutput(img.imageRef);
		expect(imageRef).toBe(
			"us-east1-docker.pkg.dev/my-project/my-repo/my-image@sha256:abc123def456",
		);
	});

	it("uses additive triggers with imageTag first when no triggers specified", async () => {
		const img = new NixImage("test-triggers-default", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "dev",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
		});

		await resolveOutput(img.digest);

		const cmds = byName("test-triggers-default-build-push");
		expect(cmds).toHaveLength(1);

		const triggers = cmds[0].inputs.triggers as string[];
		expect(triggers).toEqual(["dev"]);
	});

	it("uses additive triggers: imageTag plus custom triggers", async () => {
		const img = new NixImage("test-triggers-custom", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "dev",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
			triggers: ["custom-trigger-1", "custom-trigger-2"],
		});

		await resolveOutput(img.digest);

		const cmds = byName("test-triggers-custom-build-push");
		expect(cmds).toHaveLength(1);

		const triggers = cmds[0].inputs.triggers as string[];
		expect(triggers).toEqual(["dev", "custom-trigger-1", "custom-trigger-2"]);
	});

	it("uses resolve mode additive triggers with imageTag first", async () => {
		const img = new NixImage("test-resolve-triggers", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "v2.0.0",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
			mode: "resolve",
		});

		await resolveOutput(img.digest);

		const cmds = byName("test-resolve-triggers-resolve");
		expect(cmds).toHaveLength(1);

		const triggers = cmds[0].inputs.triggers as string[];
		expect(triggers).toEqual(["v2.0.0"]);
	});

	it("produces correct imageRef in resolve mode", async () => {
		const img = new NixImage("test-resolve-ref", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "v1.0.0",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
			mode: "resolve",
		});

		const imageRef = await resolveOutput(img.imageRef);
		expect(imageRef).toBe(
			"us-east1-docker.pkg.dev/my-project/my-repo/my-image@sha256:abc123def456",
		);
	});

	it("trims trailing newline from resolve stdout", async () => {
		const img = new NixImage("test-resolve-trim", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "v1.0.0",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
			mode: "resolve",
		});

		const digest = await resolveOutput(img.digest);
		expect(digest).toBe("sha256:abc123def456");
		expect(digest).not.toContain("\n");
	});

	it("registers outputs imageRef and digest", async () => {
		const img = new NixImage("test-outputs", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "dev",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
		});

		const digest = await resolveOutput(img.digest);
		const imageRef = await resolveOutput(img.imageRef);

		expect(digest).toBeTruthy();
		expect(imageRef).toBeTruthy();
		expect(imageRef).toContain(digest);
	});

	it("uses the sector7:nix:NixImage type token", async () => {
		const img = new NixImage("test-type-token", {
			nixAttr: "packages.x86_64-linux.my-image",
			imageName: "my-image",
			imageTag: "dev",
			artifactRegistryUrl: "us-east1-docker.pkg.dev/my-project/my-repo",
			repoRoot: "/home/user/my-repo",
		});

		await resolveOutput(img.digest);

		const component = resources.find(
			(r) => r.type === "sector7:nix:NixImage" && r.name === "test-type-token",
		);
		expect(component).toBeDefined();
	});
});

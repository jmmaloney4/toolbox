import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NixOutput } from "../nix-output/nix-output";

type MockResource = {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
	parent?: string;
};

const resources: MockResource[] = [];

beforeAll(() => {
	pulumi.runtime.setMocks({
		newResource: (args) => {
			const state = args.inputs;

			// For command.local.Command, simulate stdout with STORE_PATH_OUTPUT marker
			if (args.type === "command:local:Command") {
				const create = state.create as string | undefined;

				if (create?.includes("nix-output-resolve.sh")) {
					const env = state.environment as Record<string, string> | undefined;
					const subPath = env?.SUB_PATH;
					const baseStorePath = "/nix/store/abc123-myapp-1.0.0";
					const storePath = subPath
						? `${baseStorePath}/${subPath}`
						: baseStorePath;

					(state as Record<string, unknown>).stdout =
						`=== Resolved: ${storePath} ===\nSTORE_PATH_OUTPUT:${storePath}\n`;
				}
			}

			resources.push({
				type: args.type,
				name: args.name,
				inputs: state as Record<string, unknown>,
				parent: args.parent?.urn ?? undefined,
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

describe("NixOutput", () => {
	it("creates a Command resource in resolve mode by default", async () => {
		const output = new NixOutput("test-default", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
		});

		await resolveOutput(output.storePath);

		const cmds = byName("test-default-resolve");
		expect(cmds).toHaveLength(1);

		const cmd = cmds[0];
		expect(cmd.type).toBe("command:local:Command");
		expect(cmd.inputs.environment).toEqual({
			NIX_ATTR: "packages.x86_64-linux.myapp",
			REPO_ROOT: "/home/user/my-repo",
			SCRIPT_MODE: "resolve",
			COMMAND_LOG_STEM: ".pulumi/command-logs/test-default",
		});
	});

	it("creates a Command resource in build mode when specified", async () => {
		const output = new NixOutput("test-build", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
			mode: "build",
		});

		await resolveOutput(output.storePath);

		const cmds = byName("test-build-resolve");
		expect(cmds).toHaveLength(1);

		const cmd = cmds[0];
		expect(cmd.inputs.environment).toMatchObject({
			SCRIPT_MODE: "build",
			NIX_ATTR: "packages.x86_64-linux.myapp",
			REPO_ROOT: "/home/user/my-repo",
		});
	});

	it("parses STORE_PATH_OUTPUT marker from stdout", async () => {
		const output = new NixOutput("test-storepath", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
		});

		const storePath = await resolveOutput(output.storePath);
		expect(storePath).toBe("/nix/store/abc123-myapp-1.0.0");
	});

	it("passes subOutput as SUB_OUTPUT env var", async () => {
		const output = new NixOutput("test-suboutput", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
			subOutput: "docs",
		});

		await resolveOutput(output.storePath);

		const cmds = byName("test-suboutput-resolve");
		expect(cmds).toHaveLength(1);
		expect(cmds[0].inputs.environment).toMatchObject({
			SUB_OUTPUT: "docs",
		});
	});

	it("passes subPath as SUB_PATH env var and resolves full path", async () => {
		const output = new NixOutput("test-subpath", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
			subPath: "assets/style.css",
		});

		const storePath = await resolveOutput(output.storePath);
		expect(storePath).toBe("/nix/store/abc123-myapp-1.0.0/assets/style.css");
	});

	it("combines subOutput and subPath", async () => {
		const output = new NixOutput("test-combined", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
			subOutput: "docs",
			subPath: "api/index.html",
		});

		const storePath = await resolveOutput(output.storePath);
		expect(storePath).toBe("/nix/store/abc123-myapp-1.0.0/api/index.html");

		const cmds = byName("test-combined-resolve");
		expect(cmds[0].inputs.environment).toMatchObject({
			SUB_OUTPUT: "docs",
			SUB_PATH: "api/index.html",
		});
	});

	it("uses nixAttr as default trigger", async () => {
		const output = new NixOutput("test-trigger-default", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
		});

		await resolveOutput(output.storePath);

		const cmds = byName("test-trigger-default-resolve");
		expect(cmds).toHaveLength(1);

		const triggers = cmds[0].inputs.triggers as string[];
		expect(triggers).toEqual(["packages.x86_64-linux.myapp"]);
	});

	it("appends custom triggers after nixAttr", async () => {
		const output = new NixOutput("test-trigger-custom", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
			triggers: ["commit-sha-abc", "v2.0.0"],
		});

		await resolveOutput(output.storePath);

		const cmds = byName("test-trigger-custom-resolve");
		expect(cmds).toHaveLength(1);

		const triggers = cmds[0].inputs.triggers as string[];
		expect(triggers).toEqual([
			"packages.x86_64-linux.myapp",
			"commit-sha-abc",
			"v2.0.0",
		]);
	});

	it("passes extra env vars to the command", async () => {
		const output = new NixOutput("test-env", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
			env: { MY_VAR: "my-value" },
		});

		await resolveOutput(output.storePath);

		const cmds = byName("test-env-resolve");
		expect(cmds[0].inputs.environment).toMatchObject({
			MY_VAR: "my-value",
		});
	});

	it("registers storePath as output", async () => {
		const output = new NixOutput("test-outputs", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
		});

		const storePath = await resolveOutput(output.storePath);
		expect(storePath).toBeTruthy();
		expect(storePath).toMatch(/^\/nix\/store\//);
	});

	it("uses the sector7:nix:NixOutput type token", async () => {
		const output = new NixOutput("test-type-token", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
		});

		await resolveOutput(output.storePath);

		const component = resources.find(
			(r) => r.type === "sector7:nix:NixOutput" && r.name === "test-type-token",
		);
		expect(component).toBeDefined();
	});

	it("does not include SUB_OUTPUT or SUB_PATH when not specified", async () => {
		const output = new NixOutput("test-no-sub", {
			nixAttr: "packages.x86_64-linux.myapp",
			repoRoot: "/home/user/my-repo",
		});

		await resolveOutput(output.storePath);

		const cmds = byName("test-no-sub-resolve");
		const env = cmds[0].inputs.environment as Record<string, unknown>;
		expect(env).not.toHaveProperty("SUB_OUTPUT");
		expect(env).not.toHaveProperty("SUB_PATH");
	});
});

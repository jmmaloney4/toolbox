import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { getScriptPath } from "../scripts/index.ts";
import { NixOutput } from "../nix-output/nix-output.ts";

export interface NixImageArgs {
	/** Flake attribute path (e.g. "packages.x86_64-linux.lens-api-image") */
	nixAttr: pulumi.Input<string>;
	/** Image name in the registry (e.g. "lens-api") */
	imageName: pulumi.Input<string>;
	/** Tag to push (e.g. "dev", "v1.2.3") */
	imageTag: pulumi.Input<string>;
	/** Registry URL (e.g. "us-east1-docker.pkg.dev/addenda-dev/addenda") */
	artifactRegistryUrl: pulumi.Input<string>;
	/** Absolute path to the repo root containing the flake */
	repoRoot: pulumi.Input<string>;
	/** Additional trigger values (added alongside imageTag) */
	triggers?: pulumi.Input<string>[];
	/**
	 * "build" = build+push the image (default)
	 * "resolve" = skip build, just resolve the digest of the already-pushed tag
	 */
	mode?: "build" | "resolve";
	/**
	 * Authentication mode for pushing images.
	 * - "gcloud" (default): uses `gcloud auth print-access-token` for GCP Artifact Registry
	 * - "ghcr": uses GITHUB_USER + GITHUB_TOKEN env vars for GitHub Container Registry
	 */
	authMode?: "gcloud" | "ghcr";
	/** Extra environment variables to pass to the build-push command. */
	env?: Record<string, pulumi.Input<string>>;
}

export class NixImage extends pulumi.ComponentResource {
	/** Full image reference with digest (e.g. "registry/image@sha256:...") */
	public readonly imageRef: pulumi.Output<string>;
	/** The digest (e.g. "sha256:...") */
	public readonly digest: pulumi.Output<string>;

	constructor(
		name: string,
		args: NixImageArgs,
		opts?: pulumi.ComponentResourceOptions,
	) {
		// Build resource aliases: add URN alias when parented so the child
		// resource is adopted correctly under the parent.
		const aliases: pulumi.Alias[] = [];
		if (opts?.parent) {
			aliases.push({ parent: opts.parent });
		}

		super("sector7:nix:NixImage", name, args, {
			...opts,
			aliases: [...aliases, ...(opts?.aliases ?? [])],
		});

		const pushScriptPath = getScriptPath("nix-image-push.sh");
		const commandLogStem = `.pulumi/command-logs/${name}`;

		const mode = args.mode ?? "build";
		const authMode = args.authMode ?? "gcloud";

		const baseEnv: Record<string, pulumi.Input<string>> = {
			...(args.env ?? {}),
			IMAGE_NAME: args.imageName,
			IMAGE_TAG: args.imageTag,
			ARTIFACT_REGISTRY_URL: args.artifactRegistryUrl,
			AUTH_MODE: authMode,
			COMMAND_LOG_STEM: commandLogStem,
		};

		if (mode === "resolve") {
			// Resolve-only: authenticate and inspect the already-pushed image
			const resolveCmd = new command.local.Command(`${name}-resolve`, {
				create: pulumi.interpolate`bash "${pushScriptPath}"`,
				environment: {
					...baseEnv,
					SCRIPT_MODE: "resolve",
				},
				triggers: [args.imageTag, ...(args.triggers ?? [])],
			}, { parent: this });

			this.digest = resolveCmd.stdout.apply((stdout: string) => {
				const match = stdout.trim().match(/DIGEST_OUTPUT:(sha256:[a-f0-9]+)/);
				if (!match) {
					throw new Error(`Could not parse DIGEST_OUTPUT from resolve output for ${name}`);
				}
				return match[1];
			});
			this.imageRef = pulumi.interpolate`${args.artifactRegistryUrl}/${args.imageName}@${this.digest}`;
		} else {
			// Build + push: compose NixOutput for the build step, then push
			const nixOutput = new NixOutput(`${name}-build`, {
				nixAttr: args.nixAttr,
				repoRoot: args.repoRoot,
				mode: "build",
				triggers: [args.imageTag, ...(args.triggers ?? [])],
				env: args.env,
			}, { parent: this });

			// Push the built image from the store path
			const pushCmd = new command.local.Command(`${name}-push`, {
				create: pulumi.interpolate`bash "${pushScriptPath}"`,
				environment: {
					...baseEnv,
					SCRIPT_MODE: "push",
					STORE_PATH: nixOutput.storePath,
				},
				triggers: pulumi.all([args.imageTag, nixOutput.storePath, ...(args.triggers ?? [])]),
		}, { parent: this });

			this.digest = pushCmd.stdout.apply((stdout: string) => {
				const match = stdout.trim().match(/DIGEST_OUTPUT:(sha256:[a-f0-9]+)/);
				if (!match) {
					throw new Error(`Could not parse DIGEST_OUTPUT from push output for ${name}`);
				}
				return match[1];
			});
			this.imageRef = pulumi.interpolate`${args.artifactRegistryUrl}/${args.imageName}@${this.digest}`;
		}

		this.registerOutputs({
			imageRef: this.imageRef,
			digest: this.digest,
		});
	}
}

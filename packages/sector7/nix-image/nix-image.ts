import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import { getScriptPath } from "../scripts/index.ts";

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
	repoRoot: string;
	/** Additional trigger values (default: [imageTag]) */
	triggers?: pulumi.Input<string>[];
	/**
	 * "build" = build+push the image (default)
	 * "resolve" = skip build, just resolve the digest of the already-pushed tag
	 */
	mode?: "build" | "resolve";
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
		super("sector7:nix:NixImage", name, {}, opts);

		const scriptPath = getScriptPath("nix-image-build-push.sh");
		const commandLogStem = `.pulumi/command-logs/${name}`;

		const mode = args.mode ?? "build";

		if (mode === "resolve") {
			// Resolve-only: inspect the already-pushed image to get its digest
			const fullTag = pulumi.interpolate`${args.artifactRegistryUrl}/${args.imageName}:${args.imageTag}`;

			const resolveCmd = new command.local.Command(`${name}-resolve`, {
				create: pulumi.interpolate`nix run github:nlewo/nix2container#skopeo-nix2container -- inspect --override-os linux docker://${fullTag} 2>/dev/null | grep -o '"digest":"[^"]*"' | cut -d'"' -f4`,
				triggers: args.triggers ?? [args.imageTag],
			}, { parent: this });

			this.digest = resolveCmd.stdout;
			this.imageRef = pulumi.interpolate`${args.artifactRegistryUrl}/${args.imageName}@${this.digest}`;
		} else {
			// Build + push
			const buildCmd = new command.local.Command(`${name}-build-push`, {
				create: pulumi.interpolate`bash ${scriptPath}`,
				environment: {
					NIX_ATTR: args.nixAttr,
					IMAGE_NAME: args.imageName,
					IMAGE_TAG: args.imageTag,
					ARTIFACT_REGISTRY_URL: args.artifactRegistryUrl,
					REPO_ROOT: args.repoRoot,
					RESULT_LINK: `result-${name}`,
					COMMAND_LOG_STEM: commandLogStem,
				},
				triggers: args.triggers ?? [args.imageTag],
			}, { parent: this });

			// Parse DIGEST_OUTPUT: from stdout
			this.digest = buildCmd.stdout.apply((stdout: string) => {
				const match = stdout.match(/DIGEST_OUTPUT:(sha256:[a-f0-9]+)/);
				if (!match) {
					throw new Error(`Could not parse DIGEST_OUTPUT from build output for ${name}`);
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

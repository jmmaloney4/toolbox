import {
	type CustomResourceOptions,
	dynamic,
	type Input,
	type Output,
	type ComponentResourceOptions,
	type Resource,
} from "@pulumi/pulumi";
import * as crypto from "node:crypto";
import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

/**
 * A single static file to upload to R2 as a Pulumi-managed resource.
 */
export interface AssetFile {
	/**
	 * Absolute path to the local file on disk.
	 */
	filePath: Input<string>;

	/**
	 * R2 object key (e.g., "index.html", "styles/main.css").
	 */
	key: Input<string>;

	/**
	 * MIME content type (e.g., "text/html; charset=utf-8").
	 */
	contentType: Input<string>;
}

/**
 * Configuration for declarative R2 asset uploads.
 *
 * When provided, `uploadAssets` creates a scoped R2 API token and uploads each
 * listed file as a separate Pulumi dynamic resource.  Content changes are
 * detected via MD5 comparison against the stored ETag — no external binary
 * required.
 *
 * Notes
 * -----
 * The generated AccountToken is scoped to R2_BUCKET_ITEM_WRITE on the specific
 * bucket only.  Credentials are derived per Cloudflare's spec:
 *   accessKeyId     = token.id
 *   secretAccessKey = SHA-256(token.value)
 */
export interface AssetConfig {
	/**
	 * Files to upload.  Each file becomes a separate Pulumi R2Object resource.
	 */
	files: AssetFile[];
}

/**
 * Inputs accepted at the call site.  Pulumi resolves all `Input<T>` values
 * before passing them to the dynamic provider, so secrets (which are
 * `Output<string>`) are valid here.
 *
 * Authentication uses an R2-specific API token pair derived from a
 * Cloudflare AccountToken: accessKeyId = token.id, secretAccessKey =
 * SHA-256(token.value).
 */
export interface R2ObjectInputs {
	/** Cloudflare account ID that owns the R2 bucket. */
	accountId: Input<string>;
	/** Name of the R2 bucket. */
	bucketName: Input<string>;
	/** Object key within the bucket (e.g. "index.html"). */
	key: Input<string>;
	/** Absolute path to the local file to upload. */
	filePath: Input<string>;
	/** MIME type for the Content-Type header (e.g. "text/html; charset=utf-8"). */
	contentType: Input<string>;
	/** R2 API token access key ID (= AccountToken.id). Store as a Pulumi secret. */
	accessKeyId: Input<string>;
	/** R2 API token secret access key (= SHA-256 of AccountToken.value). Store as a Pulumi secret. */
	secretAccessKey: Input<string>;
}

/**
 * Arguments for `uploadAssets`.
 */
export interface UploadAssetsArgs {
	/** Cloudflare account ID. */
	accountId: Input<string>;
	/** Name of the R2 bucket to upload to. */
	bucketName: Input<string>;
	/** Files to upload. */
	files: AssetFile[];
	/** Resource dependencies (e.g. the Worker and bucket). */
	dependsOn?: Input<Input<Resource>[]>;
}

/**
 * Resolved inputs as seen inside the dynamic provider callbacks.
 * All values are plain strings — Pulumi resolves Input<T> before invoking the provider.
 */
interface R2ObjectArgs {
	accountId: string;
	bucketName: string;
	key: string;
	filePath: string;
	contentType: string;
	accessKeyId: string;
	secretAccessKey: string;
}

/** State persisted in Pulumi for each R2Object resource. */
interface R2ObjectState extends R2ObjectArgs {
	/**
	 * MD5 hex digest of the uploaded file content (matches the S3/R2 ETag format).
	 * Stored in state and compared on the next `diff` call to detect content changes.
	 */
	etag: string;
}

const tryStatFileSync = (
	fs: typeof import("node:fs"),
	filePath: string,
): boolean => {
	try {
		return fs.statSync(filePath).isFile();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
};

const tryReadFileSync = (
	fs: typeof import("node:fs"),
	filePath: string,
): Buffer | undefined => {
	try {
		return fs.readFileSync(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
};

/** Upload a file to R2 and return the normalized ETag. */
const uploadObjectToR2 = async (args: R2ObjectArgs): Promise<string> => {
	const fs = (await import("node:fs")) as typeof import("node:fs");
	const nodeCrypto = (await import("node:crypto")) as typeof import("node:crypto");

	const {
		accountId,
		bucketName,
		key,
		filePath,
		contentType,
		accessKeyId,
		secretAccessKey,
	} = args;
	const client = new S3Client({
		region: "auto",
		endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
		credentials: { accessKeyId, secretAccessKey },
	});
	const body = fs.readFileSync(filePath);
	const result = await client.send(
		new PutObjectCommand({
			Bucket: bucketName,
			Key: key,
			Body: body,
			ContentType: contentType,
		}),
	);
	return (
		result.ETag ?? nodeCrypto.createHash("md5").update(body).digest("hex")
	).replace(/"/g, "");
};

/**
 * Pulumi dynamic resource provider that manages a single object in a
 * Cloudflare R2 bucket via the S3-compatible API.
 *
 * Notes
 * -----
 * Node built-in imports (fs, crypto) are inlined as dynamic import() calls
 * inside provider callbacks rather than imported at module top level.  Pulumi
 * serializes the provider object via V8 source capture; top-level ES module
 * imports of Node built-ins capture native-code functions that cannot be
 * serialized, causing a "Function code: function () { [native code] }" error.
 * Dynamic import() calls are emitted verbatim and evaluated at runtime after
 * deserialization.  See the Pulumi dynamic provider serialization docs:
 * https://www.pulumi.com/docs/concepts/resources/dynamic-providers/#how-dynamic-providers-are-serialized
 *
 * The `@aws-sdk/client-s3` import IS static because this module lives behind
 * the `./workersite/r2` sub-path — consumers who need R2 upload must install
 * it as a required dependency.
 *
 * Lifecycle
 * ---------
 * - check  : verify the local file exists
 * - diff   : compare MD5(file) to stored etag; replace on key/bucket/account change
 * - create : PutObject with body + content-type; store etag
 * - update : re-upload via PutObject; store new etag
 * - delete : DeleteObject
 */
const r2ObjectProvider: dynamic.ResourceProvider = {
	async check(
		_olds: R2ObjectState,
		news: R2ObjectArgs,
	): Promise<dynamic.CheckResult> {
		const fs = (await import("node:fs")) as typeof import("node:fs");
		const failures: dynamic.CheckFailure[] = [];
		try {
			if (!tryStatFileSync(fs, news.filePath)) {
				failures.push({
					property: "filePath",
					reason: `file not found: ${news.filePath}`,
				});
			}
		} catch (error) {
			failures.push({
				property: "filePath",
				reason: `failed to stat file: ${news.filePath}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			});
		}
		return { inputs: news, failures };
	},

	async diff(
		_id: string,
		olds: R2ObjectState,
		news: R2ObjectArgs,
	): Promise<dynamic.DiffResult> {
		const fs = (await import("node:fs")) as typeof import("node:fs");
		const nodeCrypto = (await import(
			"node:crypto"
		)) as typeof import("node:crypto");

		const replaces: string[] = [];
		if (olds.key !== news.key) replaces.push("key");
		if (olds.bucketName !== news.bucketName) replaces.push("bucketName");
		if (olds.accountId !== news.accountId) replaces.push("accountId");
		if (olds.accessKeyId !== news.accessKeyId) replaces.push("accessKeyId");
		if (olds.secretAccessKey !== news.secretAccessKey)
			replaces.push("secretAccessKey");

		const currentFile = tryReadFileSync(fs, news.filePath);
		const currentEtag = currentFile
			? nodeCrypto.createHash("md5").update(currentFile).digest("hex")
			: // Missing files should force a change without crashing refresh/diff.
				"";
		const changed =
			replaces.length > 0 ||
			currentEtag !== olds.etag ||
			news.contentType !== olds.contentType;

		return { changes: changed, replaces, deleteBeforeReplace: true };
	},

	async create(inputs: R2ObjectArgs): Promise<dynamic.CreateResult> {
		const etag = await uploadObjectToR2(inputs);
		const { bucketName, key } = inputs;
		return { id: `${bucketName}/${key}`, outs: { ...inputs, etag } };
	},

	async update(
		_id: string,
		_olds: R2ObjectState,
		news: R2ObjectArgs,
	): Promise<dynamic.UpdateResult> {
		const etag = await uploadObjectToR2(news);
		return { outs: { ...news, etag } };
	},

	async delete(_id: string, props: R2ObjectState): Promise<void> {
		const { accountId, bucketName, key, accessKeyId, secretAccessKey } = props;
		const client = new S3Client({
			region: "auto",
			endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
			credentials: { accessKeyId, secretAccessKey },
		});
		await client.send(
			new DeleteObjectCommand({ Bucket: bucketName, Key: key }),
		);
	},
};

/**
 * A single object stored in a Cloudflare R2 bucket.
 *
 * Uses the S3-compatible API for all CRUD operations.  Content changes are
 * detected via MD5 comparison against the stored ETag — no external binary
 * required.
 *
 * Parameters
 * ----------
 * name : str
 *     Pulumi resource name.
 * args : R2ObjectInputs
 *     Bucket coordinates, local file path, content-type, and R2 API credentials.
 * opts : pulumi.CustomResourceOptions, optional
 *     Standard Pulumi resource options.
 */
export class R2Object extends dynamic.Resource {
	/** ETag of the uploaded object as returned by R2 (MD5 hex, no quotes). */
	public readonly etag!: Output<string>;

	constructor(
		name: string,
		args: R2ObjectInputs,
		opts?: CustomResourceOptions,
	) {
		super(r2ObjectProvider, name, { etag: undefined, ...args }, opts);
	}
}

// Cloudflare permission group ID for R2 bucket item write access.
// Used to scope the API token created for asset uploads.
const R2_BUCKET_ITEM_WRITE_PERMISSION_GROUP_ID =
	"2efd5506f9c8494dacb1fa10a3e7d5b6";

/**
 * Upload static assets to R2 as Pulumi-managed resources.
 *
 * Creates a scoped R2 API token and uploads each file as a separate
 * `R2Object` dynamic resource with MD5-based change detection.
 * Returns the created `R2Object` instances.
 *
 * This function lives on the `./workersite/r2` sub-path to isolate the
 * `@aws-sdk/client-s3` dependency from consumers that only need
 * `WorkerSite` infrastructure (ADR-014).
 *
 * @param name - Pulumi resource name prefix.
 * @param args - Upload configuration (account, bucket, files).
 * @param opts - Pulumi component resource options (set `parent` to the WorkerSite).
 * @returns Array of created R2Object resources.
 */
export function uploadAssets(
	name: string,
	args: UploadAssetsArgs,
	opts?: ComponentResourceOptions,
): R2Object[] {
	const parent = opts?.parent;
	const resourceOpts = parent ? { parent } : {};

	// Create a scoped R2 API token for uploads.
	const r2Token = new cloudflare.AccountToken(
		`${name}-r2-token`,
		{
			accountId: args.accountId,
			name: `${name}-r2-upload`,
			policies: [
				{
					effect: "allow",
					permissionGroups: [
						{
							id: R2_BUCKET_ITEM_WRITE_PERMISSION_GROUP_ID,
						},
					],
					resources: pulumi
						.output({
							accountId: args.accountId,
							bucketName: args.bucketName,
						})
						.apply(
							({ accountId, bucketName }: { accountId: string; bucketName: string }) => {
								const key = `com.cloudflare.edge.r2.bucket.${accountId}_default_${bucketName}`;
								return JSON.stringify({ [key]: "*" });
							},
						),
				},
			],
		},
		resourceOpts,
	);

	const accessKeyId = r2Token.id;
	const secretAccessKey = r2Token.value.apply((v: string) =>
		crypto.createHash("sha256").update(v).digest("hex"),
	);

	const assets: R2Object[] = [];
	for (let index = 0; index < args.files.length; index++) {
		const file = args.files[index];
		const r2obj = new R2Object(
			`${name}-asset-${index}`,
			{
				accountId: args.accountId,
				bucketName: args.bucketName,
				key: file.key,
				filePath: file.filePath,
				contentType: file.contentType,
				accessKeyId,
				secretAccessKey,
			},
			{
				...resourceOpts,
				dependsOn: args.dependsOn,
			},
		);
		assets.push(r2obj);
	}

	return assets;
}

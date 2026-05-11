import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type R2ObjectProvider = {
	check: (
		olds: unknown,
		news: Record<string, string>,
	) => Promise<{ failures: Array<{ property: string; reason: string }> }>;
	diff: (
		id: string,
		olds: Record<string, string>,
		news: Record<string, string>,
	) => Promise<{
		changes: boolean;
		replaces?: string[];
		deleteBeforeReplace?: boolean;
	}>;
};

type DynamicResourceCall = {
	name: string;
	opts: Record<string, unknown> | undefined;
	provider: R2ObjectProvider;
};

type AccountTokenCall = {
	name: string;
	opts: Record<string, unknown> | undefined;
};

let provider: R2ObjectProvider | undefined;
const dynamicResourceCalls: DynamicResourceCall[] = [];
const accountTokenCalls: AccountTokenCall[] = [];

vi.mock("@pulumi/pulumi", () => {
	const output = <T>(value: T) => ({
		apply: <U>(fn: (value: T) => U) => fn(value),
	});

	return {
		all: <T>(value: T) => output(value),
		output,
		mergeOptions: (
			left: Record<string, unknown>,
			right: Record<string, unknown>,
		) => ({ ...left, ...right }),
		dynamic: {
			Resource: class {
				constructor(
					resourceProvider: R2ObjectProvider,
					name: string,
					_args: Record<string, unknown>,
					opts?: Record<string, unknown>,
				) {
					provider = resourceProvider;
					dynamicResourceCalls.push({ name, opts, provider: resourceProvider });
				}
			},
		},
	};
});

vi.mock("@pulumi/cloudflare", () => ({
	AccountToken: class {
		public readonly id = "token-id";
		public readonly value = {
			apply: (fn: (value: string) => string | Promise<string>) => fn("token-value"),
		};

		constructor(
			name: string,
			_args: Record<string, unknown>,
			opts?: Record<string, unknown>,
		) {
			accountTokenCalls.push({ name, opts });
		}
	},
}));

import { purgeZoneCache, R2Object, uploadAssets } from "../r2/r2object.ts";

const createArgs = (filePath: string) => ({
	accountId: "account-123",
	bucketName: "bucket-123",
	key: "index.html",
	filePath,
	contentType: "text/html; charset=utf-8",
	accessKeyId: "access-key",
	secretAccessKey: "secret-key",
});

const cloudProviderOpt = { provider: { urn: "cloudflare-provider" } };

describe("R2Object provider", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "r2object-test-"));
		provider = undefined;
		dynamicResourceCalls.length = 0;
		accountTokenCalls.length = 0;
		new R2Object("asset", createArgs(join(tempDir, "bootstrap.txt")));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("reports a check failure when the file path no longer exists", async () => {
		const missingPath = join(tempDir, "missing.txt");

		const result = await provider!.check({}, createArgs(missingPath));

		expect(result.failures).toEqual([
			{
				property: "filePath",
				reason: `file not found: ${missingPath}`,
			},
		]);
	});

	it("treats a missing file as a diff instead of throwing ENOENT", async () => {
		const missingPath = join(tempDir, "missing.txt");
		const olds = {
			...createArgs(missingPath),
			etag: createHash("md5").update("previous contents").digest("hex"),
		};

		const result = await provider!.diff("bucket-123/index.html", olds, {
			...createArgs(missingPath),
		});

		expect(result).toMatchObject({
			changes: true,
			replaces: [],
			deleteBeforeReplace: true,
		});
	});

	it("keeps unchanged files stable during diff", async () => {
		const filePath = join(tempDir, "index.html");
		const body = "<h1>hello</h1>";
		writeFileSync(filePath, body);

		const result = await provider!.diff(
			"bucket-123/index.html",
			{
				...createArgs(filePath),
				etag: createHash("md5").update(body).digest("hex"),
			},
			createArgs(filePath),
		);

		expect(result).toMatchObject({
			changes: false,
			replaces: [],
			deleteBeforeReplace: true,
		});
	});

	it("rejects cloud provider options when R2Object is constructed directly", () => {
		expect(
			() => new R2Object("asset", createArgs(join(tempDir, "index.html")), cloudProviderOpt),
		).toThrow(/R2Object is a Pulumi dynamic resource; do not pass provider\/providers/);
	});
});

describe("uploadAssets", () => {
	beforeEach(() => {
		provider = undefined;
		dynamicResourceCalls.length = 0;
		accountTokenCalls.length = 0;
	});

	it("keeps provider options on the Cloudflare token but strips them from dynamic R2 objects", () => {
		uploadAssets(
			"site",
			{
				accountId: "account-123",
				bucketName: "bucket-123",
				files: [
					{
						key: "index.html",
						filePath: "/tmp/index.html",
						contentType: "text/html; charset=utf-8",
					},
				],
			},
			cloudProviderOpt,
		);

		expect(accountTokenCalls).toHaveLength(1);
		expect(accountTokenCalls[0].opts).toMatchObject(cloudProviderOpt);
		expect(dynamicResourceCalls).toHaveLength(1);
		expect(dynamicResourceCalls[0].opts).not.toHaveProperty("provider");
		expect(dynamicResourceCalls[0].opts).not.toHaveProperty("providers");
	});
});

describe("purgeZoneCache", () => {
	beforeEach(() => {
		provider = undefined;
		dynamicResourceCalls.length = 0;
		accountTokenCalls.length = 0;
	});

	it("rejects cloud provider options with a clear dynamic-resource error", () => {
		expect(() =>
			purgeZoneCache(
				"purge",
				{
					zoneId: "zone-123",
					apiToken: "token",
					trigger: "asset-hash",
				},
				cloudProviderOpt,
			),
		).toThrow(/purgeZoneCache is a Pulumi dynamic resource; do not pass provider\/providers/);
	});
});

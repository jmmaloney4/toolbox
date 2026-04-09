import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockProvider = {
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

let provider: MockProvider | undefined;

vi.mock("@pulumi/pulumi", () => ({
	dynamic: {
		Resource: class {
			constructor(capturedProvider: MockProvider) {
				provider = capturedProvider;
			}
		},
	},
}));

import { R2Object } from "../workersite/r2object.ts";

const createArgs = (filePath: string) => ({
	accountId: "account-123",
	bucketName: "bucket-123",
	key: "index.html",
	filePath,
	contentType: "text/html; charset=utf-8",
	accessKeyId: "access-key",
	secretAccessKey: "secret-key",
});

describe("R2Object provider", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "r2object-test-"));
		provider = undefined;
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
});

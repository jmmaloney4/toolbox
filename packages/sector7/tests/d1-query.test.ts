import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type D1Provider = {
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
	args: Record<string, unknown>;
	opts: Record<string, unknown> | undefined;
	provider: D1Provider;
};

let provider: D1Provider | undefined;
const dynamicResourceCalls: DynamicResourceCall[] = [];

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
					resourceProvider: D1Provider,
					name: string,
					args: Record<string, unknown>,
					opts?: Record<string, unknown>,
				) {
					provider = resourceProvider;
					dynamicResourceCalls.push({ name, args, opts, provider: resourceProvider });
				}
			},
		},
	};
});

import { D1Query } from "../d1/d1-query.ts";

const createArgs = (sql = "CREATE TABLE t (id INTEGER);") => ({
	accountId: "account-123",
	databaseId: "db-456",
	sql,
	apiToken: "test-token",
});

const cloudProviderOpt = { provider: { urn: "cloudflare-provider" } };

describe("D1Query provider", () => {
	beforeEach(() => {
		provider = undefined;
		dynamicResourceCalls.length = 0;
		new D1Query("test", createArgs());
	});

	it("registers a dynamic resource with correct args", () => {
		expect(dynamicResourceCalls).toHaveLength(1);
		expect(dynamicResourceCalls[0].name).toBe("test");
		expect(dynamicResourceCalls[0].args.accountId).toBe("account-123");
		expect(dynamicResourceCalls[0].args.databaseId).toBe("db-456");
		expect(dynamicResourceCalls[0].args.sql).toBe("CREATE TABLE t (id INTEGER);");
		expect(dynamicResourceCalls[0].args.apiToken).toBe("test-token");
	});

	it("reports no check failures for valid inputs", async () => {
		const result = await provider!.check({}, createArgs());
		expect(result.failures).toHaveLength(0);
	});

	it("reports check failures when required fields are missing", async () => {
		const result = await provider!.check({}, {} as Record<string, string>);
		expect(result.failures.length).toBeGreaterThanOrEqual(1);
	});

	it("detects no changes when SQL is unchanged", async () => {
		const olds = { ...createArgs(), sqlHash: createHash("sha256").update(createArgs().sql).digest("hex") };
		const result = await provider!.diff("test-id", olds, createArgs());
		expect(result.changes).toBe(false);
	});

	it("detects changes when SQL is modified", async () => {
		const oldSql = "CREATE TABLE t (id INTEGER);";
		const newSql = "CREATE TABLE t (id INTEGER, name TEXT);";
		const olds = { ...createArgs(oldSql), sqlHash: createHash("sha256").update(oldSql).digest("hex") };
		const result = await provider!.diff("test-id", olds, { ...createArgs(), sql: newSql });
		expect(result.changes).toBe(true);
		expect(result.replaces).toContain("sql");
	});

	it("triggers delete-before-replace when SQL changes", async () => {
		const oldSql = "CREATE TABLE t (id INTEGER);";
		const newSql = "CREATE TABLE t (id INTEGER, name TEXT);";
		const olds = { ...createArgs(oldSql), sqlHash: createHash("sha256").update(oldSql).digest("hex") };
		const result = await provider!.diff("test-id", olds, { ...createArgs(), sql: newSql });
		expect(result.deleteBeforeReplace).toBe(true);
	});

	it("detects changes when apiToken is rotated", async () => {
		const sql = "CREATE TABLE t (id INTEGER);";
		const olds = { ...createArgs(sql), sqlHash: createHash("sha256").update(sql).digest("hex") };
		const result = await provider!.diff("test-id", olds, {
			...createArgs(),
			apiToken: "new-token",
		});
		expect(result.changes).toBe(true);
		// Token change does not trigger replacement, just update
		expect(result.replaces).toHaveLength(0);
		expect(result.deleteBeforeReplace).toBe(false);
	});

	it("rejects cloud provider options", () => {
		expect(
			() => new D1Query("bad-opts", createArgs(), cloudProviderOpt as any),
		).toThrow(/D1Query is a Pulumi dynamic resource/);
	});
});

import { describe, expect, it } from "vitest";
import { generateWorkerScript } from "../workersite/worker-site-script.ts";

const extractFingerprintMatcher = (script: string): ((key: string) => boolean) => {
	const match = script.match(
		/function isFingerprintAssetKey\(key\) \{[\s\S]*?\n\}/,
	);
	expect(match).not.toBeNull();
	return new Function(`${match![0]}; return isFingerprintAssetKey;`)() as (
		key: string,
	) => boolean;
};

describe("generateWorkerScript", () => {
	it("produces a basic fetch handler with no prefix or redirects", () => {
		const script = generateWorkerScript("R2_BUCKET");
		expect(script).toContain("env.R2_BUCKET.get(objectKey)");
		expect(script).toContain("// No prefix configured");
		expect(script).not.toContain("Response.redirect");
	});

	it("injects prefixes and redirects when configured", () => {
		const script = generateWorkerScript("R2_BUCKET", "docs", [
			{ fromHost: "www.example.com", toHost: "example.com", statusCode: 302 },
		]);

		expect(script).toContain('objectKey = "docs/" + objectKey');
		expect(script).toContain('url.hostname === "www.example.com"');
		expect(script).toContain('redirectUrl.hostname = "example.com"');
		expect(script).toContain("Response.redirect");
	});

	it("uses browser-safe cache headers for non-fingerprinted files", () => {
		const script = generateWorkerScript("R2_BUCKET");

		expect(script).toContain("isFingerprintAssetKey(objectKey)");
		expect(script).toContain(
			"public, max-age=0, s-maxage=${maxAge}, must-revalidate",
		);
		expect(script).toContain("public, max-age=31536000, immutable");

		const isFingerprintAssetKey = extractFingerprintMatcher(script);
		expect(isFingerprintAssetKey("assets/index-B_PaUjV8.js")).toBe(true);
		expect(isFingerprintAssetKey("assets/app.a1b2c3d4.css")).toBe(true);
		expect(isFingerprintAssetKey("assets/app-a1b2c3d4.js")).toBe(true);
		expect(isFingerprintAssetKey("styles.css")).toBe(false);
		expect(isFingerprintAssetKey("index.html")).toBe(false);
		expect(isFingerprintAssetKey("favicon.svg")).toBe(false);
	});
});

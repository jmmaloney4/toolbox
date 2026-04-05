import { describe, expect, it } from "vitest";
import { generateWorkerScript } from "../workersite/worker-site-script.ts";

describe("generateWorkerScript", () => {
	it("produces a basic fetch handler with no prefix or redirects", () => {
		const script = generateWorkerScript("R2_BUCKET");
		expect(script).toContain("env.R2_BUCKET.get(objectKey)");
		expect(script).toContain("// No prefix configured");
		expect(script).toContain("Response.redirect");
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
});

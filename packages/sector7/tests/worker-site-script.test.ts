import { describe, expect, it } from "vitest";
import { generateWorkerScript } from "../workersite/worker-site-script";

describe("generateWorkerScript", () => {
	it("includes the core worker bindings and cache behavior", () => {
		const script = generateWorkerScript("R2_BUCKET");

		expect(script).toContain("R2_BUCKET");
		expect(script).toContain("CACHE_TTL_SECONDS");
		expect(script).toContain("caches.default");
		expect(script).toContain("index.html");
		expect(script).toContain("createResponse");
	});

	it("injects prefixes and redirects when configured", () => {
		const script = generateWorkerScript("R2_BUCKET", "docs", [
			{ fromHost: "www.example.com", toHost: "example.com", statusCode: 302 },
		]);

		expect(script).toContain("docs/");
		expect(script).toContain('url.hostname === "www.example.com"');
		expect(script).toContain('redirectUrl.hostname = "example.com"');
		expect(script).toContain("Response.redirect");
	});
});

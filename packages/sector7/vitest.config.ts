import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["workersite/**/*.test.ts"],
		exclude: ["dist/**"],
	},
});

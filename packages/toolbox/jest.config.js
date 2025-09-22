/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/*.test.ts"],
	collectCoverageFrom: [
		"pulumi/**/*.ts",
		"!pulumi/**/*.d.ts",
		"!pulumi/**/*.test.ts",
	],
	coverageDirectory: "coverage",
	verbose: true,
};

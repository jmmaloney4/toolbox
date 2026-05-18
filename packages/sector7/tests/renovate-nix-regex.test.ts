import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const nixConfig = JSON.parse(
	readFileSync(resolve(process.cwd(), "../../renovate/nix.json"), "utf8"),
) as {
	customManagers: Array<{
		description: string;
		matchStrings: string[];
	}>;
};

function managerRegexes(description: string): RegExp[] {
	const manager = nixConfig.customManagers.find(
		(candidate) => candidate.description === description,
	);

	expect(manager).toBeDefined();
	return manager!.matchStrings.map((pattern) => new RegExp(pattern, "m"));
}

function firstMatch(regexes: RegExp[], input: string) {
	return regexes.map((regex) => input.match(regex)).find(Boolean);
}

const sriHash = "sha256-XRJNwpeGjQSEPub34BLrPJn3Tj6Ie90/PB7LR2+tPmU=";

describe("renovate/nix.json mkHelmChartFromGitHub regex managers", () => {
	it("matches ARC chart blocks that use real Nix SRI hashes", () => {
		const arcRegex = managerRegexes(
			"Update mkHelmChartFromGitHub ARC chart packages in Nix files",
		)[0];
		const arcBlock = [
			"mkHelmChartFromGitHub rec {",
			'  pname = "gha-runner-scale-set-controller-chart";',
			'  version = "v0.27.6";',
			'  owner = "actions";',
			'  repo = "actions-runner-controller";',
			'  rev = "gha-runner-scale-set-${version}";',
			`  hash = "${sriHash}";`,
			"};",
		].join("\n");

		const match = arcBlock.match(arcRegex);
		expect(match?.groups?.depName).toBe(
			"gha-runner-scale-set-controller-chart",
		);
		expect(match?.groups?.currentValue).toBe("v0.27.6");
		expect(match?.groups?.owner).toBe("actions");
		expect(match?.groups?.repo).toBe("actions-runner-controller");
	});

	it("matches generic chart blocks that use real Nix SRI hashes", () => {
		const genericRegexes = managerRegexes(
			"Update mkHelmChartFromGitHub packages in Nix files",
		);
		const genericBlock = `mkHelmChartFromGitHub {
  pname = "envoy-gateway-crds-chart";
  version = "1.8.0";
  owner = "envoyproxy";
  repo = "gateway";
  hash = "${sriHash}";
};`;

		const match = firstMatch(genericRegexes, genericBlock);
		expect(match?.groups?.depName).toBe("envoy-gateway-crds-chart");
		expect(match?.groups?.currentValue).toBe("1.8.0");
		expect(match?.groups?.owner).toBe("envoyproxy");
		expect(match?.groups?.repo).toBe("gateway");
	});

	it("matches generic chart blocks with chartSubdir before hash", () => {
		const genericRegexes = managerRegexes(
			"Update mkHelmChartFromGitHub packages in Nix files",
		);
		const chartSubdirBlock = `mkHelmChartFromGitHub rec {
  pname = "some-chart";
  version = "1.2.3";
  owner = "example";
  repo = "repo";
  chartSubdir = "charts/some-chart";
  hash = "${sriHash}";
};`;

		const match = firstMatch(genericRegexes, chartSubdirBlock);
		expect(match?.groups?.depName).toBe("some-chart");
		expect(match?.groups?.currentValue).toBe("1.2.3");
		expect(match?.groups?.owner).toBe("example");
		expect(match?.groups?.repo).toBe("repo");
	});

	it("does not let the generic matcher swallow ARC chart blocks with rev lines", () => {
		const genericRegexes = managerRegexes(
			"Update mkHelmChartFromGitHub packages in Nix files",
		);
		const arcBlock = [
			"mkHelmChartFromGitHub rec {",
			'  pname = "gha-runner-scale-set-controller-chart";',
			'  version = "v0.27.6";',
			'  owner = "actions";',
			'  repo = "actions-runner-controller";',
			'  rev = "gha-runner-scale-set-${version}";',
			`  hash = "${sriHash}";`,
			"};",
		].join("\n");

		expect(arcBlock.match(genericRegexes[0])).toBeNull();
	});
});

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

function managerRegex(description: string): RegExp {
	const manager = nixConfig.customManagers.find(
		(candidate) => candidate.description === description,
	);

	expect(manager).toBeDefined();
	return new RegExp(manager!.matchStrings[0], "m");
}

const sriHash = "sha256-XRJNwpeGjQSEPub34BLrPJn3Tj6Ie90/PB7LR2+tPmU=";

describe("renovate/nix.json mkHelmChartFromGitHub regex managers", () => {
	it("matches ARC chart blocks that use real Nix SRI hashes", () => {
		const arcRegex = managerRegex(
			"Update mkHelmChartFromGitHub ARC chart packages in Nix files",
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

		const match = arcBlock.match(arcRegex);
		expect(match?.groups?.depName).toBe(
			"gha-runner-scale-set-controller-chart",
		);
		expect(match?.groups?.currentValue).toBe("v0.27.6");
		expect(match?.groups?.owner).toBe("actions");
		expect(match?.groups?.repo).toBe("actions-runner-controller");
	});

	it("matches generic chart blocks that use real Nix SRI hashes", () => {
		const genericRegex = managerRegex(
			"Update mkHelmChartFromGitHub packages in Nix files",
		);
		const genericBlock = `mkHelmChartFromGitHub {
  pname = "envoy-gateway-crds-chart";
  version = "1.8.0";
  owner = "envoyproxy";
  repo = "gateway";
  hash = "${sriHash}";
};`;

		const match = genericBlock.match(genericRegex);
		expect(match?.groups?.depName).toBe("envoy-gateway-crds-chart");
		expect(match?.groups?.currentValue).toBe("1.8.0");
		expect(match?.groups?.owner).toBe("envoyproxy");
		expect(match?.groups?.repo).toBe("gateway");
	});

	it("does not let the generic matcher swallow ARC chart blocks with rev lines", () => {
		const genericRegex = managerRegex(
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

		expect(arcBlock.match(genericRegex)).toBeNull();
	});
});

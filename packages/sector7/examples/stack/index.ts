import * as pulumi from "@pulumi/pulumi";
import {
	GithubActionsWorkloadIdentityProvider,
	type GithubActionsWorkloadIdentityProviderArgs,
	WorkloadIdentityPoolResource,
} from "../../iam";

const config = new pulumi.Config();
const wif =
	config.requireObject<GithubActionsWorkloadIdentityProviderArgs>("wif");

// Example reusable pool defined in the stack
const pool = new WorkloadIdentityPoolResource("github-pool", {
	poolId: pulumi.interpolate`github-${pulumi.getStack()}`,
	displayName: "GitHub Actions",
	description: "Identity pool for GitHub Actions",
});

const githubOidc = new GithubActionsWorkloadIdentityProvider("github-oidc", {
	...wif,
	pool,
});

export const serviceAccountEmail = githubOidc.serviceAccountEmail;
export const workloadIdentityProviderResource =
	githubOidc.workloadIdentityProviderResource;

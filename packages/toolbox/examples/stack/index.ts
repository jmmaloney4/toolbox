import * as pulumi from "@pulumi/pulumi";
import { type GitHubOidcArgs, GitHubOidcResource } from "../../pulumi";

const config = new pulumi.Config();
const wif = config.requireObject<GitHubOidcArgs>("wif");

const githubOidc = new GitHubOidcResource("github-oidc", wif);

export const serviceAccountEmail = githubOidc.serviceAccountEmail;
export const workloadIdentityProviderResource =
	githubOidc.workloadIdentityProviderResource;

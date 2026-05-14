---
id: ADR-022
title: GitHub App authentication for add-to-project workflow
status: Proposed
date: 2026-05-14
deciders: [Jack Maloney]
consulted: []
tags: [design, adr, ci, authentication]
supersedes: []
superseded_by: []
links:
  - https://github.com/actions/add-to-project/issues/158
---

# Context

The reusable workflow `.github/workflows/add-to-project.yml` adds issues and PRs
to an org-level GitHub Project. It currently requires a `github-token` secret
that must be a Personal Access Token (PAT). The built-in `GITHUB_TOKEN` will not
work because it is scoped to the triggering repository and cannot access
org-level Projects.

PAT-based authentication creates operational friction:

- PATs are tied to a specific user. If that user leaves or rotates the token,
  every repo calling this workflow must update its secret.
- A PAT makes all project modifications appear to come from the token owner,
  not from the automation itself.
- PATs require periodic manual rotation.

A GitHub App installation token solves all three: it is org-scoped, identifies
itself as the app, and requires no periodic rotation (installation tokens are
short-lived and minted per-workflow-run).

## Scope

This ADR documents the authentication approach. It does not itself change the
workflow -- that is a separate implementation step.

# Decision

Callers of the `add-to-project` workflow MAY authenticate via a GitHub App
installation token instead of a PAT, using the `tibdex/github-app-token` action
to mint the token at runtime.

The workflow itself should remain unchanged in its public contract -- it accepts
a `github-token` secret of any kind. The GitHub App auth step lives in the
caller workflow, not inside `add-to-project.yml`. This keeps the reusable
workflow simple and avoids baking a specific token-generation action into its
surface.

## Caller-side pattern

```yaml
jobs:
  add-to-project:
    runs-on: ubuntu-latest
    steps:
      - name: Generate GitHub App token
        id: generate_token
        uses: tibdex/github-app-token@36464acb844fc53b9b8b2401da68844f6b05ebb0
        with:
          app_id: ${{ secrets.APP_ID }}
          private_key: ${{ secrets.APP_PEM }}

      - name: Add to Project
        uses: jmmaloney4/sector7/.github/workflows/add-to-project.yml@main
        with:
          project-url: https://github.com/orgs/ergodicsystems/projects/1
        secrets:
          github-token: ${{ steps.generate_token.outputs.token }}
```

## Required GitHub App configuration

- The app MUST have read/write access to **Organization projects** under
  Organization permissions.
- The app MUST be installed on any repository that will call the workflow.
- After changing permissions in the app settings, the installation must be
  updated (re-approve access) for the new permissions to take effect.

## Required repository secrets

| Secret    | Description                        |
|-----------|------------------------------------|
| `APP_ID`  | GitHub App numeric ID              |
| `APP_PEM` | App private key (.pem contents)    |

## Known limitation

GitHub Apps **cannot access user-level V2 projects**. They only work for
org-level projects. This is a hard limitation confirmed by GitHub Support. The
workflow's default `project_url` points to an org project, so this is not a
problem for current use.

# Consequences

## Positive

- No PAT tied to a user identity. App identity survives personnel changes.
- Project modifications are attributed to the app, not an individual.
- No manual token rotation -- installation tokens are minted per run and expire
  after one hour.
- Finer-grained scoping: the app can be limited to specific repositories.

## Negative

- Requires creating and configuring a GitHub App at the org level.
- Adds a step (`tibdex/github-app-token`) to every caller workflow.
- Private key storage in `APP_PEM` secret must be rotated if compromised.
- Does not work for user-level projects.

# Alternatives

- **PAT (current approach)**: Simplest setup, but ties automation to a user,
  requires manual rotation, and attributes changes to the token owner.
- **vidavidorra/github-app-token**: Alternative to tibdex for token generation.
  Functionally equivalent. Tibdex has broader adoption and a pinned SHA in
  upstream examples.
- **Bake app token generation into the reusable workflow**: Would simplify
  callers but couples the workflow to a specific token-generation action and
  forces all callers to provide `APP_ID` / `APP_PEM` even if they prefer a PAT.

# Security / Privacy / Compliance

- The `APP_PEM` secret contains a private RSA key. Store as a repository or
  org-level secret. Do not log or echo it.
- Installation tokens expire after one hour, limiting blast radius if leaked.
- The `tibdex/github-app-token` action is pinned by SHA, not by tag, to prevent
  supply-chain compromise.
- Review which repositories have the app installed. The app's token grants
  permissions across all installed repos.

# Operational Notes

- When creating a new GitHub App for this purpose, pin the app ID and generate
  a private key immediately. Store both in org-level secrets so all repos in the
  org can access them.
- The app does not need a webhook URL or public endpoint -- it is used solely
  for token generation.
- If the private key is rotated, update the `APP_PEM` secret in all repos (or
  at the org level) before the old key expires.

# Status Transitions

None.

# Implementation Notes

To adopt this across repos:

1. Create a GitHub App in the target org with read/write org project access.
2. Store `APP_ID` and `APP_PEM` as org-level secrets.
3. Update caller workflows to mint an installation token before calling
   `add-to-project`.
4. Remove the old PAT secret once all callers are migrated.

Owner: Jack Maloney

# References

- actions/add-to-project issue #158:
  https://github.com/actions/add-to-project/issues/158
- GitHub Community Discussion: GitHub Apps and V2 Projects:
  https://github.com/orgs/community/discussions/46681
- GitHub Docs: Authenticating with GitHub Apps:
  https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app

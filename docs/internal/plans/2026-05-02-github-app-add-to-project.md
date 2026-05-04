# GitHub App Auth for add-to-project Workflow

**Date:** 2026-05-02\
**Author:** jack\
**Status:** Draft\
**Related PRs:** toolbox#163 (merged — required github-token secret)

______________________________________________________________________

## Context

The `add-to-project` reusable workflow (`.github/workflows/add-to-project.yml`)
calls `actions/add-to-project` to add issues/PRs to the ergodicsystems org
project board. This action requires a token with org-level Projects write access.

`GITHUB_TOKEN` cannot do this — it is scoped to the triggering repository and
has no access to org Projects (GraphQL Projects V2 API). A personal access token
works but expires (fine-grained PATs: max 1 year) and is coupled to a human
account.

A GitHub App is the right default: scoped permissions, no expiry, not tied to a
person. PR #163 made `github-token` a required secret on the reusable workflow.
This plan covers the app creation, workflow updates, and caller migration.

______________________________________________________________________

## Step 1 — Register the GitHub App

**Where:** ergodicsystems org settings → GitHub Apps → New GitHub App

**Configuration:**

| Field | Value |
|---|---|
| Name | `toolbox-project-bot` |
| Homepage URL | `https://github.com/jmmaloney4/toolbox` |
| Webhook | Active: unchecked (no webhooks needed) |
| Permissions → Organization → Projects | Read and write |
| Permissions → Repository → Metadata | Read-only |
| Where can this App be installed? | Any account |

After registration:

1. Note the **App ID** (integer).
2. Generate a **private key** (PEM) — download and store securely.
3. Install the app on the **ergodicsystems** org. Grant access to all repos
   (or none — the app only needs org-level project permission, not repo access).

No installation is needed on consumer repos like `jmmaloney4/garden`. The app's
permission to touch org projects comes from the org installation.

______________________________________________________________________

## Step 2 — Store credentials as secrets

Store the following as **organization secrets** on `ergodicsystems` (preferred) or
as **repository secrets** on each consumer repo:

| Secret name | Value |
|---|---|
| `TOOLBOX_PROJECT_BOT_APP_ID` | App ID (integer) |
| `TOOLBOX_PROJECT_BOT_PRIVATE_KEY` | Full PEM contents |

Organization secrets are preferred because every consumer repo can reference them
without duplication. If any callers live outside the org (e.g. `jmmaloney4/garden`),
store them as repo secrets there instead.

______________________________________________________________________

## Step 3 — Update the reusable workflow (toolbox)

The reusable workflow should generate the app token itself so callers don't need
to deal with `actions/create-github-app-token` in every repo.

**New design:**

```yaml
on:
  workflow_call:
    secrets:
      app-id:
        description: GitHub App ID with org project write access
        required: false
      private-key:
        description: GitHub App private key (PEM)
        required: false
```

The job generates a token via `actions/create-github-app-token@v2` and passes it
to `actions/add-to-project`. This keeps the complexity in one place.

**Fallback:** If `app-id` and `private-key` are not provided, the workflow should
fail with a clear error message explaining what secrets are needed.

______________________________________________________________________

## Step 4 — Update caller workflows

### jmmaloney4/garden

Current:
```yaml
jobs:
  add-to-project:
    uses: jmmaloney4/toolbox/.github/workflows/add-to-project.yml@main
```

After:
```yaml
jobs:
  add-to-project:
    uses: jmmaloney4/toolbox/.github/workflows/add-to-project.yml@main
    secrets:
      app-id: ${{ secrets.TOOLBOX_PROJECT_BOT_APP_ID }}
      private-key: ${{ secrets.TOOLBOX_PROJECT_BOT_PRIVATE_KEY }}
```

### Other consumers

Any repo using this reusable workflow needs the same change. Search for
`jmmaloney4/toolbox/.github/workflows/add-to-project.yml` across the org.

______________________________________________________________________

## Step 5 — Verify end-to-end

1. Open a test issue in `jmmaloney4/garden`.
2. Confirm the workflow runs and the issue appears on
   https://github.com/orgs/ergodicsystems/projects/1.
3. Test with a PR as well (different trigger path).
4. Confirm the labeled filter path works by labeling an issue and checking
   the label-based step fires.

______________________________________________________________________

## PR Sequence

1. **toolbox** — Update reusable workflow to use `actions/create-github-app-token`
   as the default auth method, with clear failure message if secrets are missing.
2. **garden** — Update caller to pass `app-id` and `private-key` secrets.
3. **Other consumers** — Same pattern as garden, if any.

______________________________________________________________________

## Alternatives considered

| Approach | Pros | Cons |
|---|---|---|
| Fine-grained PAT | Simple to set up | Expires within 1 year; tied to personal account; manual rotation |
| Classic PAT | Works today | Overly broad scopes; tied to personal account; security risk |
| GitHub App (chosen) | Scoped, no expiry, org-owned | More setup upfront; slightly more complex workflow |

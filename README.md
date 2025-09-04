# workflows

A shared home for **reusable workflows** and **composite actions** used across my projects to keep CI/CD consistent, fast, and easy to evolve.

---

## How to use (start here)

Below are copy-paste snippets for calling the **reusable workflows** and **composite actions** published by this repo. Pin to a **tag** (e.g., `@v1`) or a **commit SHA** for reproducibility.

### Reusable workflows

> Reusable workflows live in this repo under `.github/workflows/*.yml` and are called from another repo’s workflow **as a job** with `uses:`.

**1) Standard CI pipeline (build + test)**
Caller repo: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  app-ci:
    uses: jmmaloney4/workflows/.github/workflows/ci.yml@v1
    with:
      node-version: "22"
      run-e2e: false
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }} # if your project needs it
```

**2) Release pipeline (version, build, publish GitHub Release)**
Caller repo: `.github/workflows/release.yml`

```yaml
name: Release
on:
  workflow_dispatch:
    inputs:
      tag:
        description: "Release tag (e.g. v1.2.3)"
        required: true
jobs:
  release:
    uses: jmmaloney4/workflows/.github/workflows/release.yml@v1
    with:
      tag: ${{ inputs.tag }}
    secrets: inherit  # or pass explicitly if you prefer
```

**3) Deploy with environment approvals**
Caller repo: `.github/workflows/deploy.yml`

```yaml
name: Deploy
on:
  workflow_dispatch:

jobs:
  deploy:
    uses: jmmaloney4/workflows/.github/workflows/deploy.yml@v1
    with:
      environment: "production"
      app-name: "my-service"
      image-tag: ${{ github.sha }}
    secrets:
      CLOUD_AUTH: ${{ secrets.CLOUD_AUTH }}
```

> Tip: If your repo needs the same pipeline with small tweaks, prefer adding **inputs** to the reusable workflow here, rather than copying the whole thing.

---

### Composite actions

> Composite actions live under `.github/actions/<name>/action.yml` and are called as **steps** inside your jobs.

**1) Node build with cache**
Caller repo step:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jmmaloney4/workflows/.github/actions/node-build@v1
        id: nb
        with:
          node-version: "22"
          build-script: "build"
      - uses: actions/upload-artifact@v4
        with:
          name: web-dist
          path: ${{ steps.nb.outputs.dist }}
```

**2) Python lint & test**

```yaml
- uses: jmmaloney4/workflows/.github/actions/python-checks@v1
  with:
    python-version: "3.11"
    lint: "ruff"
    test-command: "pytest -q"
```

**3) Docker login + push**

```yaml
- uses: jmmaloney4/workflows/.github/actions/docker-push@v1
  with:
    registry: "ghcr.io"
    image: "ghcr.io/jmmaloney4/my-app"
    tag: ${{ github.sha }}
  env:
    CR_PAT: ${{ secrets.GITHUB_TOKEN }} # or a PAT with packages:write
```

> Pin **versions** (`@v1`, `@v1.2.0`, or a commit SHA) to avoid surprises. When you’re ready to adopt changes, bump the tag in callers.

---

## Explainer: Reusable workflows vs Composite actions (when and why)

**Summary for skimmers:**

* **Reusable workflows** = **pipeline reuse** (**multiple jobs**, **services**, **approvals**, **permissions**, **artifacts**, **matrices**).
* **Composite actions** = **step reuse** inside a single job (**glue CLI + other actions**, quick & portable).
* Use **reusable workflows** for cross-repo, policy-enforced CI/CD; use **composite actions** for shareable building blocks inside jobs.
* Prefer **inputs**, **outputs**, and **least-privilege permissions**; pin to **tags/SHAs**; publish **semver** releases.

### Reusable workflows (deep dive)

**What they are**
A full workflow stored in this repo that other repos call with:

```yaml
jobs:
  myjob:
    uses: jmmaloney4/workflows/.github/workflows/<name>.yml@v1
```

They’re enabled by an `on: workflow_call:` block and can declare **inputs**, **secrets**, and **outputs**. They can define **multiple jobs**, use `needs:` for orchestration, run **services** (e.g., Postgres/Redis), enforce **environment approvals**, configure **permissions**, **concurrency**, **matrices**, and pass **artifacts** between jobs.

**When to use**

* You want an org-standard **CI or release pipeline** across many repos.
* You need **multi-job** orchestration or **services**.
* You want **approvals** (e.g., prod deploy) and centralized **permissions**.
* You need to **return outputs** (e.g., a build SHA) to the caller.

**Strengths**

* Strong policy & structure, fewer footguns.
* Easy to roll out **org-wide changes** by updating one place.
* Clear versioning with tags.

**Trade-offs**

* Heavier abstraction: more to learn for simple, one-off jobs.
* Changes affect many repos—pin versions and follow semver.

### Composite actions (deep dive)

**What they are**
A bundle of **steps** (mix of `run:` and `uses:`) that runs inside a **single job** on the caller’s runner:

```yaml
- uses: jmmaloney4/workflows/.github/actions/<name>@v1
  with: { ... }
```

They’re perfect for repeated **procedures**: toolchain setup, caching, linting, small builds, and CLI-driven deploy fragments.

**When to use**

* You repeat the **same steps** across jobs/repos.
* You want a clean interface via **inputs/outputs**.
* You don’t need services, matrices, or multiple jobs.

**Strengths**

* Lightweight and fast to adopt.
* Composable inside any job.
* Great for language/tool **setup** & **checks**.

**Trade-offs**

* No jobs, services, or environment approvals.
* Job-level things (permissions, concurrency) are controlled by the **caller**, not the action.

---

## What’s included in this repo

> Names are stable; versions advance with semver. See each file’s README header for exact inputs/outputs.

### Reusable workflows (pipelines)

* `ci.yml` — Build/test pipeline with optional E2E; supports Node projects; emits build metadata.
* `release.yml` — Tag, build, generate notes/SBOM (if applicable), create GitHub Release, attach artifacts.
* `deploy.yml` — Environment-aware deploy with optional approvals; takes an `image-tag` and `app-name`.

### Composite actions (building blocks)

* `node-build` — Setup Node + cache + run build; outputs `dist` path.
* `python-checks` — Setup Python, install dev deps, run lint/tests.
* `docker-push` — Login and push an image to a registry (GHCR by default).
* `version-bump` — Compute next semver from conventional commits and write it to a file/output.

> If you need a variant (e.g., Rust, Go, or a different test runner), open an issue or PR—prefer **inputs** over forks when practical.

---

## Conventions & best practices

* **Pin versions** of workflows/actions you consume: `@v1` or a **commit SHA**.
* **Semver**:

  * `v1` = stable major (backward-compatible changes).
  * `v2` = breaking changes.
* **Permissions**: workflows set least-privilege defaults; callers can **tighten** further.
* **Secrets**: pass explicitly in `secrets:` (or `inherit` if appropriate).
* **Caching**: standardized keys to speed up builds; purge with a new key if needed.
* **Outputs**: composites and workflows expose outputs so you can chain steps/jobs.
* **Docs**: each workflow/action has a short header explaining inputs/outputs and side effects.

---

## Contributing

* Propose changes via PR. Keep interfaces **small and explicit** (inputs/outputs).
* For breaking changes, bump **major** and update the README examples.
* Add/extend **inputs** instead of forking a second “almost-the-same” variant.
* Include a minimal **example** in the PR description so callers can adopt easily.

---

## FAQ

* **Should I use a composite action or a reusable workflow?**
  If you need **multiple jobs/services** or **approvals**, choose a **reusable workflow**. If you just need a **reusable step bundle**, choose a **composite action**.

* **How do I roll out a fix to all repos?**
  Update here, cut a new tag (e.g., `v1.3.0`), then bump consumers. For urgent fixes, you can temporarily pin to a **commit SHA**.

* **Can I use composites from inside a reusable workflow?**
  Yes—that’s a great pattern: put your **procedural** logic in composites and orchestrate them from **reusable workflows**.

---

If you have a repo that needs a custom pipeline, open an issue with your requirements (language, build steps, test matrix, deploy target). I’ll help fold it into a reusable workflow and/or composite action so the whole ecosystem benefits.

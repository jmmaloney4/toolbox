---
id: ADR-008
title: Local GitHub Actions Integration Testing with act
status: Proposed
date: 2026-01-22
deciders: [jmmaloney4]
consulted: []
tags: [design, adr, ci, github-actions, testing]
supersedes: []
superseded_by: []
links: []
---

# Context
- The ADR management workflow is complex and failures are often only visible after a PR is opened.
- We need a fast, repeatable way to exercise workflows locally, especially those that operate on PR payloads.
- Pure linting is insufficient; we want to execute the jobs and inspect logs with real files.

# Decision
- Use the `act` CLI as the primary local integration test tool for GitHub Actions workflows.
- Provide a minimal PR event fixture for local runs and document example commands.
- Favor the `catthehacker/ubuntu:act-latest` runner image to approximate GitHub hosted runners.

# Consequences
## Positive
- Developers can reproduce workflow behavior before pushing PRs.
- Faster debugging loop with access to full container logs.

## Negative
- Requires Docker and runner images on developer machines.
- Behavior can still differ from GitHub runners, especially for hosted services.

# Alternatives
- Rely solely on GitHub CI runs: simplest but slow feedback and no local debugging.
- Add temporary `workflow_dispatch` hooks for testing: easy but risks accidental merge.
- Maintain a dedicated test repository: high fidelity but additional maintenance.

# Security / Privacy / Compliance
- Avoid passing real secrets into `act` runs; prefer `.env` files with local-only values.
- Do not bake credentials into fixture event payloads.

# Operational Notes
- Requires Docker Desktop or a compatible container runtime.
- Default runner image: `catthehacker/ubuntu:act-latest`.
- Local runs should be treated as best-effort; CI remains the source of truth.

# Status Transitions
- None.

# Implementation Notes
- Add a `pr-event.json` fixture for ADR workflow testing.
- Document a standard command in README or contributor docs.

# References
- https://github.com/nektos/act

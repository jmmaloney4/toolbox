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

---

# Appendix A: VCS-Coupled vs VCS-Independent Testing

## Problem Statement

The current integration test approach (`tests/act/run-adr-test.sh`) requires:
1. A clean VCS working directory (jj/git)
2. Creating test branches and commits
3. Generating realistic PR event payloads with valid SHAs

This adds complexity to test execution. We evaluated whether a VCS-independent approach could simplify testing without sacrificing coverage.

## Analysis

### VCS Operations in the ADR Workflow

The workflow's core logic is inherently VCS-dependent:

| Workflow Step | VCS Operations |
|---------------|----------------|
| `detect-adrs` | `git diff --name-only --diff-filter=A main..HEAD` |
| `process-adrs` | `git checkout main` / `git checkout <sha>` for branch comparison |
| `handle-conflicts` | `git checkout -b`, `git mv`, `git push`, `gh pr create` |

These operations are not incidental - they implement the primary business logic: "Does this ADR number conflict with what exists on main?"

### What VCS-Independent Tests Could Cover

The `create-adr-placeholder/script.sh` contains some VCS-independent logic:
- JSON validation (`jq empty`)
- ADR number format validation (`[0-9]{3}`)
- Path traversal protection
- Title extraction from filename patterns

These could be unit tested with mocked inputs, but represent roughly 30% of the total logic.

### Trade-off Summary

| Approach | Pros | Cons |
|----------|------|------|
| **VCS-Coupled (current)** | Tests realistic scenarios; catches integration bugs at VCS boundaries; validates branch switching and conflict detection | Requires clean working directory; slower setup; jj/git mismatch with GitHub |
| **VCS-Independent** | Faster execution; simpler setup; no Docker/act dependency for unit tests | Misses core workflow logic; only tests peripheral validation; false confidence |

## Decision

**Keep VCS-coupled integration tests** as the primary validation method. The workflow's value proposition is VCS-aware conflict detection, which cannot be meaningfully tested without VCS operations.

### Mitigations for Complexity Concerns

1. **Clear prerequisites**: Document required state (clean working directory, Docker running)
2. **Automated cleanup**: The test script includes a cleanup trap to remove test branches
3. **Scenario isolation**: Tests create unique branch names with PID suffixes to avoid collisions
4. **Optional unit tests**: Consider extracting pure functions from `script.sh` for lightweight validation

### Known Limitation

The test environment uses Jujutsu (jj) while GitHub Actions uses git. The jj git compatibility layer should handle this, but subtle differences could mask issues. CI on GitHub remains the authoritative validation.

---
id: ADR-010
title: ADR Conflict Check Failure Modes and Fixes
status: Proposed
date: 2026-03-06
deciders: [jmmaloney4]
consulted: []
tags: [adr, ci, github-actions]
supersedes: []
superseded_by: []
links:
  - https://github.com/cavinsresearch/zeus/actions/runs/22771381595/job/66053053419
  - https://github.com/cavinsresearch/zeus/pull/756
---

# ADR 010: Adr Conflict Check Failure Modes

# Context

The `adr-management` reusable workflow (`.github/workflows/adr-management.yml`) is intended to
detect conflicting ADR numbers on pull requests and post a blocking comment before bad state lands
on `main`. An investigation of run
[22771381595](https://github.com/cavinsresearch/zeus/actions/runs/22771381595/job/66053053419)
on commit `e2112e2f` of PR #756 (cavinsresearch/zeus) revealed that the workflow reported success
and posted no comment despite `docs/internal/decisions` containing four groups of conflicting ADR
numbers (`092`, `094`, `097`, `098` — some three-way conflicts) already present on `main`.

This ADR classifies the four failure modes observed and proposes fixes for each.

---

# Failure Modes

## FM-1: Check only runs on newly-added files — misses pre-existing conflicts

**Root cause.** The "detect new ADR files" step runs:

```bash
git diff --diff-filter=A "origin/${BASE_REF}..HEAD" -- "$ADR_GLOB"
```

`--diff-filter=A` matches only files whose status is **Added** in the PR diff. Conflicts that
already exist on `main` before the PR was opened are invisible to this filter.

**Impact.** Once a conflicting pair of ADR numbers lands on `main`, no subsequent PR will ever
flag the pre-existing conflict. The invariant "all ADR numbers on `main` are unique" is only
enforced at the moment of addition; it is never re-validated.

---

## FM-2: Vacuous success on format-only or rename commits

**Root cause.** The caller workflow's `paths` trigger fires whenever `docs/internal/decisions/**`
changes. A pure reformatting or rename commit (no new files) satisfies the path filter, so the
workflow runs. Because `--diff-filter=A` returns empty, `has_new_adrs=false`, all subsequent
steps are skipped, and the job exits with success. No output or comment is produced.

**Impact.** The PR receives a green check mark that implies ADR health was validated, when in
reality the check was a no-op. This creates false confidence, particularly during code review.

---

## FM-3: No whole-directory uniqueness audit

**Root cause.** `check-adr-conflicts/main.sh` checks two things: (a) duplicates _within_ the
set of new files added by the PR, and (b) conflicts between a new file's number and files already
on `origin/<base_ref>`. Neither check scans the full directory for pre-existing duplicates among
files already on `main`.

**Impact.** FM-1 and FM-3 are related but distinct: FM-1 is the triggering condition (workflow
skipped), FM-3 is the algorithmic gap (even if the workflow ran, it would not have caught
pre-existing conflicts among files it did not treat as "new").

---

## FM-4: Silent skip when `has_new_adrs=false`

**Root cause.** When the workflow runs but finds no new ADR files, it exits silently. There is no
status comment on the PR, no annotation, and no log output beyond the internal variable assignment.

**Impact.** It is impossible to distinguish "the check ran and found nothing to validate" from "the
check was misconfigured and silently failed." Reviewers have no visibility into which path was
taken.

---

# Decision

Address each failure mode as described below.

## Fix for FM-1 and FM-3: Add a full-directory uniqueness audit step

Add a new step (or a new composite action) that runs unconditionally — regardless of
`has_new_adrs` — and scans _all_ files matching `$ADR_GLOB` in the working tree for duplicate
number prefixes:

```bash
# Extract 3-digit prefixes from all ADR filenames on disk (not just diff)
find . -path "./${ADR_GLOB#./}" -name '*.md' \
  | sed 's|.*/\([0-9]\{3\}\)-.*|\1|' \
  | sort \
  | uniq -d
```

If any duplicates are found, fail the step and post a PR comment listing the conflicting files.
This audit replaces the current "check only new files" approach as the primary gate, making FM-1
and FM-3 impossible.

**Alternatives considered:**

- **A (Recommended): Replace `--diff-filter=A` scope with full-tree scan.** Run the uniqueness
  check against all files currently on disk (i.e., the PR's tree), not just the diff. This catches
  both pre-existing conflicts and new ones introduced by the PR. Slightly more expensive but
  trivially fast for any realistic ADR corpus. No behavioral regression: if the PR introduces a
  new duplicate, it is still caught.

- **B: Keep the diff-scoped check, add a separate audit step.** Retain the current
  `--diff-filter=A` logic for determining whether to run the placeholder step, but add a
  parallel unconditional audit step. This preserves the "is this an ADR PR?" signal while adding
  the missing invariant. More complex (two steps with overlapping concerns).

- **C: Run the audit only on `push` to `main`, not on PRs.** Moves the check to post-merge.
  Rejected: does not block bad merges; only detects problems after they land.

## Fix for FM-2: Add a `--diff-filter=AM` (Added or Modified/Renamed) scope and annotate no-op runs

Two sub-fixes:

1. Change `--diff-filter=A` to `--diff-filter=AM` so that renamed or modified ADR files are also
   treated as "touched" and still trigger the full-tree audit. This ensures rename operations
   (which are a common source of numbering confusion) are not silently skipped.

2. Regardless of filter result, always post a brief neutral status comment on the PR (see FM-4
   fix below).

**Alternative:** Remove the path-scoped trigger and always run the full-tree audit on any PR that
touches `docs/internal/decisions/**`. This is simpler and has no false-negative risk. Recommended
in conjunction with Option A above.

## Fix for FM-4: Post an explicit status comment in all cases

Add a final step that runs unconditionally (`if: always()`) and posts a short summary comment to
the PR:

- If conflicts were found: the existing blocking comment already covers this.
- If no conflicts and new ADRs present: "✓ No ADR number conflicts detected. New ADR(s): `NNN`."
- If no new ADRs: "ℹ ADR conflict check ran; no new ADR files detected in this PR. Full-directory
  audit passed." (or failed, with details).

This makes the check's result unambiguous to reviewers.

**Alternative:** Use a GitHub Actions job summary (`$GITHUB_STEP_SUMMARY`) instead of a PR
comment for the no-op case, to avoid comment noise. Acceptable if teams prefer fewer PR comments;
however, job summaries are less visible during code review than PR comments.

---

# Consequences

## Positive
- Pre-existing conflicts on `main` will be caught and block future PRs until resolved.
- PRs that reformat or rename ADRs without adding new ones will still trigger a meaningful audit.
- Reviewers always have explicit confirmation that the ADR check ran and what it found.

## Negative
- The full-tree scan adds a small CI step to every ADR-touching PR (negligible cost in practice).
- Surfacing pre-existing conflicts may require remediation work on `main` before other PRs can
  pass (short-term disruption, long-term correctness).
- More PR comments may be perceived as noise if many PRs touch ADR files without adding new ones.

---

# Security / Privacy / Compliance

No credentials, PII, or sensitive data involved. The workflow already uses `gh pr comment` with
the repository's default `GITHUB_TOKEN`.

---

# Operational Notes

- The full-tree audit step is idempotent and has no side effects beyond a PR comment.
- If a pre-existing conflict is found on `main`, the recommended remediation is to resolve the
  conflict directly on `main` (via a dedicated PR), not to suppress the check.
- The `create-adr-placeholder` step should remain gated on `has_new_adrs=true` (it is a write
  operation and should only run for genuine ADR additions).

---

# Implementation Notes

- Implement FM-1/FM-3 fix in `.github/actions/check-adr-conflicts/main.sh` by removing the
  early-exit on `has_new_adrs=false` and replacing it with a full `find`-based scan.
- Implement FM-4 fix as a new `always()`-gated step in `.github/workflows/adr-management.yml`.
- FM-2 fix: update `--diff-filter=A` to `--diff-filter=AM` in the "Detect new ADR files" step,
  and decouple "should we post a placeholder" from "should we run the audit".

---

# References

- Failing run: https://github.com/cavinsresearch/zeus/actions/runs/22771381595/job/66053053419
- PR #756: https://github.com/cavinsresearch/zeus/pull/756
- Reusable workflow: `.github/workflows/adr-management.yml`
- Conflict-check action: `.github/actions/check-adr-conflicts/`

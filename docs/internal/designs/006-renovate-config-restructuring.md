---
id: ADR-006
title: Renovate Configuration Restructuring for Update Type Separation
status: Proposed
date: 2026-01-07
deciders: [jmmaloney4]
consulted: []
tags: [design, adr, renovate, dependencies]
supersedes: []
superseded_by: []
links: []
---

# Context

## Problem Statement
Our Renovate configuration is currently split across multiple files in the `renovate/` directory with conflicting and inconsistent automerge rules. The current structure makes it difficult to enforce a clear policy: minor/patch updates should be grouped by ecosystem and automerged, while major updates should be individual PRs requiring manual review.

## Current File Structure
```
renovate/
├── default.json              # Base configuration
├── all.json                  # Aggregates default + lock-maintenance
├── package-groups.json       # Technology-specific package groups
├── pulumi.json              # Pulumi-specific rules and regex managers
├── nix.json                 # Nix-specific rules and regex managers
├── security.json            # Security patches and major update rules
└── lock-maintenance.json    # Lock file maintenance
```

## Current Issues

1. **Conflicting automerge rules**: Multiple files define automerge behavior leading to conflicts
   - `security.json:15` sets `automerge: false` for major updates
   - However, ecosystem-specific groups in `package-groups.json` (TypeScript:8, Node.js:14, Testing:20, Arrow:26, Rust:33, Docker:39, GitHub Actions:46), `pulumi.json:21`, and `nix.json` (41, 49, 58) set `automerge: true` without filtering by update type
   - Result: Major updates are automerged despite the intention to require manual review

2. **Inconsistent grouping**: Some ecosystems group all updates together regardless of update type, while others don't have grouping at all

3. **Unclear separation of concerns**: Update type policies (major vs minor/patch) are mixed with ecosystem-specific grouping rules across multiple files

4. **Missing ecosystem coverage**: Several package ecosystems (Python outside Nix, npm/pnpm packages outside Pulumi, Go, etc.) lack explicit grouping

## Scope

**In scope:**
- Restructuring Renovate configuration files for clear update type separation
- Ensuring major updates are never automerged
- Grouping minor/patch updates by ecosystem with automerge enabled
- Covering all major package ecosystems (Rust, Python, Node.js, Docker, GitHub Actions, Pulumi, Nix, etc.)

**Out of scope:**
- Changing base Renovate settings (schedules, PR limits, etc.)
- Modifying regex managers for custom dependency extraction
- Altering vulnerability alert handling

# Decision

We MUST restructure the Renovate configuration to explicitly separate concerns by update type, with major updates handled completely independently from minor/patch updates.

## New File Structure

```
renovate/
├── default.json              # Base settings (unchanged)
├── all.json                  # Main aggregator (MUST include new files)
├── lock-maintenance.json     # Lock file maintenance (unchanged)
├── major-updates.json        # NEW: All major updates → individual PRs, manual review
├── minor-patch-automerge.json # NEW: Minor/patch grouped by ecosystem with automerge
├── security.json             # Security & vulnerability rules (simplified)
├── pulumi.json              # Pulumi regex managers only (package rules removed)
└── nix.json                 # Nix regex managers only (package rules removed)
```

## Configuration Principles

1. **Update type separation**: Major updates MUST be handled completely separately from minor/patch updates
2. **Ecosystem grouping**: Each ecosystem (Rust, Python, Node.js, etc.) SHOULD have its own group for minor/patch updates
3. **Single source of truth**: Each policy decision MUST live in exactly one place
4. **Rule priority**: Major update rules MUST have higher priority (`prPriority`) to ensure they're never automerged

## File Responsibilities

### `major-updates.json`
```json
{
  "packageRules": [
    {
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "grouping": false,
      "reviewers": ["jmmaloney4"],
      "prPriority": 10,
      "labels": ["major-update"]
    }
  ]
}
```
- Single package rule matching ALL major updates
- MUST set `automerge: false`
- MUST NOT group (individual PRs per package)
- MUST require manual review
- MUST have high priority to override other rules

### `minor-patch-automerge.json`
```json
{
  "packageRules": [
    {
      "groupName": "Rust Dependencies",
      "matchManagers": ["cargo"],
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true
    },
    // ... one rule per ecosystem
  ]
}
```
- Multiple package rules, one per ecosystem
- MUST match only minor and patch updates via `matchUpdateTypes`
- MUST group updates by ecosystem
- MUST set `automerge: true`
- SHOULD cover: Rust, Python, Node.js, Docker, GitHub Actions, Pulumi, Nix, and others

### `pulumi.json` & `nix.json`
- MUST contain only `regexManagers` for custom dependency extraction
- MUST NOT contain package rules (moved to `minor-patch-automerge.json`)

### `security.json`
- MUST handle vulnerability alerts (unchanged)
- MAY contain security patch rules or these MAY be moved to `minor-patch-automerge.json`
- SHOULD remove redundant major update rules (now in `major-updates.json`)

# Consequences

## Positive
- **Clear policy enforcement**: Major updates will never be automerged due to explicit rule priority
- **Easier maintenance**: Adding a new ecosystem requires only adding a group to `minor-patch-automerge.json`
- **Better visibility**: Developers can quickly understand the update policy by reading two files
- **Reduced conflicts**: Update type rules are separated from ecosystem grouping rules
- **Consistent behavior**: All ecosystems follow the same major vs minor/patch policy
- **Explicit over implicit**: The use of `matchUpdateTypes` makes intent clear

## Negative
- **Migration effort**: Need to update existing configuration files and test the changes
- **More files**: Adds two new files to the configuration (6→8 files total)
- **Initial learning**: Team needs to understand the new structure

## Neutral
- **Regex managers**: Pulumi and Nix files become simpler (only regex managers) but still necessary
- **Total file count**: Overall count increases slightly (7→8 files)

# Alternatives

## Alternative A: Single monolithic file
Combine all rules into one large configuration file.

**Pros:**
- Single file to review
- No need to track which file contains which rule

**Cons:**
- Difficult to maintain as it grows
- Harder to understand structure at a glance
- Merge conflicts more likely

**Decision:** Rejected. Modularity is more valuable for long-term maintenance.

## Alternative B: Directory structure by ecosystem
```
renovate/
└── ecosystems/
    ├── rust.json
    ├── python.json
    └── ...
```

**Pros:**
- Very clear separation by ecosystem
- Easy to find ecosystem-specific rules

**Cons:**
- Splits update type policy across many files
- Harder to ensure consistent major vs minor/patch handling
- More files to maintain

**Decision:** Rejected. Update type separation is more important than ecosystem separation.

## Alternative C: Keep current structure, add override rules
Add high-priority override rules for major updates without restructuring.

**Pros:**
- Minimal changes required
- No file migration needed

**Cons:**
- Doesn't address root cause (mixing concerns)
- Still difficult to understand which rules apply
- Future confusion likely

**Decision:** Rejected. Band-aid solution that doesn't improve maintainability.

# Security / Privacy / Compliance

- **Dependency updates**: Major updates MAY contain breaking changes or security implications requiring review
- **Automerge risk**: Minor/patch updates are generally safe to automerge per semver conventions
- **Vulnerability alerts**: Remain enabled and automerged for rapid security response
- **Review requirements**: Major updates MUST be manually reviewed before merge

# Operational Notes

## Observability
- Monitor Renovate Dashboard for PR volume and merge rates
- Track time-to-merge for major vs minor/patch updates
- Review automerge failures in Renovate logs

## Cost
- No direct cost impact
- May reduce developer time spent on routine minor/patch updates
- Major updates still require manual review time

## Rollout Plan
1. Create new configuration files
2. Test locally with `renovate-config-validator`
3. Commit changes and monitor first batch of PRs
4. Verify major updates are NOT automerged
5. Verify minor/patch updates ARE automerged and grouped correctly

## Backout Plan
- Revert to previous configuration via git if issues arise
- Configuration changes take effect immediately for new PRs
- Existing PRs may need manual intervention

# Implementation Notes

## Steps
1. Create `major-updates.json` with catch-all rule for major updates
2. Create `minor-patch-automerge.json` with ecosystem-specific groups
3. Update `all.json` to extend new configuration files
4. Remove package rules from `pulumi.json` (keep regex managers)
5. Remove package rules from `nix.json` (keep regex managers)
6. Simplify `security.json` by removing redundant major update rules
7. Test configuration with `renovate-config-validator`
8. Commit changes and monitor initial PRs

## Ecosystems to Cover
- Rust (cargo)
- Python (pip, poetry, pypi)
- Node.js (npm, pnpm, yarn)
- Docker images
- GitHub Actions
- Pulumi packages
- Nix dependencies
- Go modules
- TypeScript/Testing packages

## Owner
- jmmaloney4

## Timeline
- Implementation: Single work session
- Validation: 1-2 weeks of monitoring

# References

- [Renovate Package Rules Documentation](https://docs.renovatebot.com/configuration-options/#packagerules)
- [Renovate Rule Priority](https://docs.renovatebot.com/configuration-options/#packagerules)
- [Renovate matchUpdateTypes](https://docs.renovatebot.com/configuration-options/#matchupdatetypes)
- Current configuration: `renovate/` directory
- Related files: `.github/renovate.json5`

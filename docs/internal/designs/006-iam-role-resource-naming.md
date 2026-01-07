---
id: ADR-006
title: IAM Role Resource Naming Strategy for Pulumi Resources
status: Accepted
date: 2026-01-07
deciders: [jmmaloney4]
consulted: [gemini-code-assist]
tags: [design, adr, pulumi, gcp, iam]
supersedes: []
superseded_by: []
links:
  - https://github.com/jmmaloney4/toolbox/pull/74
  - https://cloud.google.com/iam/docs/understanding-roles
---

# Context

PR #74 improves Pulumi resource naming for `gcp.projects.IAMMember` resources by including project ID and role information instead of incrementing indices (e.g., `github-wif-provider-sa-cavins-admin-cloudkms-admin` vs `github-wif-provider-sa-role-0`). This significantly improves readability in Pulumi previews and state management.

During code review, gemini-code-assist identified that the initial implementation's role sanitization logic (`role.replace(/^roles\//, "").replace(/\./g, "-")`) only handles predefined GCP roles (e.g., `roles/storage.admin`) but does not properly handle:
- **Custom project-level roles**: `projects/my-project-123/roles/deployBot`
- **Custom organization-level roles**: `organizations/123456789/roles/customOrgRole`

These non-predefined role formats would produce overly long or slash-containing resource names, reducing readability and potentially causing issues.

**In scope:**
- Sanitization strategy for all GCP IAM role formats in Pulumi resource names
- Error handling for invalid role identifiers
- Documentation and maintainability

**Out of scope:**
- Validation of GCP role format compliance (GCP APIs handle this)
- Length limiting of role IDs (GCP enforces 3-64 character limits)
- Testing infrastructure (deferred to ADR-004)

**Trigger:** Review comment on PR #74, line 157 of `packages/sector7/iam/github-actions-identity-provider.ts`

# Decision

We MUST implement a `sanitizeRoleForResourceName` function that:

1. **Extracts the role ID** from any GCP IAM role format by taking the final path segment (after the last `/`)
2. **Sanitizes for readability** by replacing dots (`.`) and underscores (`_`) with dashes (`-`)
3. **Normalizes case** by converting to lowercase for consistency
4. **Validates input** by throwing an error if the role ID cannot be extracted (empty string, malformed path)

The function MUST handle all three GCP role formats:
- Predefined: `roles/storage.admin` → `storage-admin`
- Custom project: `projects/my-project/roles/deployBot` → `deploybot`
- Custom org: `organizations/123/roles/my_custom.role` → `my-custom-role`

The function SHOULD:
- Include comprehensive JSDoc documentation with examples
- Throw meaningful errors that include the problematic role string
- Be placed near the other naming helper functions in the module

The function SHOULD NOT:
- Validate GCP role format compliance (delegated to GCP API)
- Enforce length limits on role IDs (GCP handles this)
- Perform complex pattern matching or regex validation

# Consequences

## Positive
- **Comprehensive coverage**: Handles all GCP IAM role formats correctly
- **Readable names**: Resource names remain human-friendly across all role types
- **Fail-fast behavior**: Invalid roles cause errors during `pulumi preview`, not deployment
- **Maintainable**: Self-documenting function with clear intent and examples
- **Future-proof**: Works with new custom roles without code changes

## Negative
- **Adds complexity**: Introduces a new helper function vs inline string manipulation
- **No immediate tests**: Testing deferred to ADR-004 implementation (Jest infrastructure)
- **Export requirement**: Function must be exported if tests are added later (per ADR-004)
- **Potential name collisions**: Different roles could theoretically produce the same sanitized suffix (e.g., `my.role` and `my_role` both become `my-role`), though Pulumi resource names include project ID which reduces collision likelihood

# Alternatives

## Option A: Keep simple regex replacement (current implementation)
```typescript
const roleSuffix = role.replace(/^roles\//, "").replace(/\./g, "-");
```
- **Pros**: Simplest implementation, no function overhead
- **Cons**: Only works for predefined roles; fails on custom project/org roles
- **Rejected**: Does not address review feedback

## Option B: Extract with split().pop() only
```typescript
const roleSuffix = (role.split("/").pop() || "").replace(/\./g, "-");
```
- **Pros**: Handles all role formats, very concise
- **Cons**: No validation, no error handling, no lowercase normalization, no documentation
- **Rejected**: Lacks defensive programming and discoverability

## Option C: Comprehensive validation with regex
```typescript
function sanitizeRoleForResourceName(role: string): string {
  const match = role.match(/^(roles|projects\/[^/]+\/roles|organizations\/\d+\/roles)\/([a-z][a-zA-Z0-9._]{2,63})$/);
  if (!match) throw new Error(`Invalid role: ${role}`);
  return match[2].replace(/[._]/g, "-").toLowerCase();
}
```
- **Pros**: Validates GCP role format compliance, catches malformed roles early
- **Cons**: Duplicates validation already done by GCP API, complex regex maintenance, overly defensive
- **Rejected**: Over-engineering; GCP API validation is sufficient

## Option D: Extract and sanitize with comprehensive error handling (CHOSEN)
```typescript
function sanitizeRoleForResourceName(role: string): string {
  const roleId = role.split("/").pop()?.trim() || "";
  if (!roleId) throw new Error(`Invalid IAM role: "${role}" - cannot extract role ID`);
  return roleId.replace(/[._]/g, "-").toLowerCase();
}
```
- **Pros**: Handles all formats, defensive without over-engineering, clear errors, documented
- **Cons**: Minimal (adds one function)
- **Chosen**: Best balance of correctness, simplicity, and maintainability

# Security / Privacy / Compliance

- No security concerns: function performs string manipulation only
- No credentials or sensitive data involved
- Role names are already visible in Pulumi state and GCP console
- Function validates input but does not bypass any authorization checks
- Errors during `pulumi preview` do not expose sensitive information (role strings are not secrets)

# Operational Notes

- **Observability**: Errors appear in `pulumi preview` output with clear messages
- **Cost**: No runtime cost (compile-time string manipulation)
- **Quotas/limits**: No impact on GCP quotas or limits
- **Rollout**: Immediate - affects only Pulumi resource naming (URN changes)
- **Backout**: Can revert to index-based naming, but causes URN changes requiring resource replacement
- **Migration impact**: Changing resource names causes Pulumi to replace `gcp.projects.IAMMember` resources (delete + recreate), which is expected behavior for PR #74

# Status Transitions

- 2026-01-07: **Accepted** - Decision finalized during PR #74 review

# Implementation Notes

**Owner**: jmmaloney4
**Target PR**: #74

**Key changes:**
1. Add `sanitizeRoleForResourceName` function to `packages/sector7/iam/github-actions-identity-provider.ts`
2. Update line ~157 to use `sanitizeRoleForResourceName(role)` instead of inline regex
3. Add JSDoc documentation with examples for all three role formats
4. Add TODO comment indicating tests should be added when ADR-004 is implemented

**Function placement**: After the existing `generateProviderId` function (~line 84) to group all naming helper functions together

**Testing strategy**:
- Manual verification during PR #74 review
- Automated tests to be added when ADR-004 (Jest Testing Infrastructure) is implemented
- Function should be marked for test coverage in ADR-004 implementation work

**Example resource names after implementation:**
- Predefined role: `github-wif-provider-sa-my-project-storage-admin`
- Custom project role: `github-wif-provider-sa-my-project-deploybot`
- Custom org role: `github-wif-provider-sa-my-project-custom-role`

# References

- PR #74: https://github.com/jmmaloney4/toolbox/pull/74
- Review comment: https://github.com/jmmaloney4/toolbox/pull/74#discussion_r2659215657
- GCP IAM Roles documentation: https://cloud.google.com/iam/docs/understanding-roles
- GCP Custom Roles: https://cloud.google.com/iam/docs/creating-custom-roles
- ADR-004 (Jest Testing Infrastructure): `docs/internal/designs/004-jest-testing-infrastructure.md`
- Pulumi Resource Names: https://www.pulumi.com/docs/concepts/resources/names/

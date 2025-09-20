---
id: ADR-004
title: Jest Testing Infrastructure
status: Proposed
date: 2025-09-19
deciders: [jmmaloney4]
consulted: []
tags: [design, adr, testing]
supersedes: []
superseded_by: []
links: []
---

# Context

The toolbox project currently lacks automated testing infrastructure for TypeScript/JavaScript components, specifically for the Pulumi utilities in `packages/toolbox/pulumi/`. This creates risks when refactoring or extending functionality like the `generateServiceAccountId` function, which has specific validation rules and output format requirements.

**In scope:**
- Jest testing framework integration with existing Nix/pnpm infrastructure
- Testing for pure utility functions (starting with `generateServiceAccountId`)
- CI integration via existing `nix flake check` mechanism

**Out of scope:**
- End-to-end testing of Pulumi resources
- Integration testing with cloud providers
- Performance testing

**Trigger:** Request to add test cases for `generateServiceAccountId` function.

# Decision

We MUST add Jest as our JavaScript/TypeScript testing framework, integrated with the existing Nix and pnpm infrastructure:

1. **Nix Integration**: Jest and TypeScript testing dependencies MUST be added to the flake's devShell and a `checks.test` output MUST be created that runs tests via `nix flake check`.

2. **Package Configuration**: Jest MUST be configured at the package level (`packages/toolbox/`) with TypeScript support and proper test discovery.

3. **CI Integration**: Tests MUST run automatically in CI through the existing `nix.yml` workflow without requiring new workflow files.

4. **Function Exports**: Utility functions requiring testing MUST be exported from their modules to enable isolated testing.

# Consequences

## Positive
- **Quality assurance**: Automated testing prevents regressions in utility functions
- **Documentation**: Tests serve as executable specifications for complex logic
- **Developer experience**: Tests run consistently across local/CI environments via Nix
- **Infrastructure reuse**: Leverages existing Nix/pnpm setup without additional workflows
- **Fail-fast feedback**: Tests run early in the CI pipeline via `nix flake check`

## Negative
- **Build complexity**: Adds Jest configuration and TypeScript compilation for tests
- **Dependency overhead**: Additional npm packages in devDependencies
- **Maintenance burden**: Tests require updates when implementation changes
- **Export requirements**: Some functions may need to be exported purely for testing

# Alternatives

- **Vitest**: Modern Vite-based test runner with better ESM support
  - Pros: Faster, better TypeScript integration, more modern
  - Cons: Less ecosystem maturity, potential compatibility issues with Pulumi SDK

- **Node.js built-in test runner**: Uses native Node.js testing (Node 18+)
  - Pros: No additional dependencies, very lightweight
  - Cons: Limited features, less tooling, basic assertion library

- **Deno test**: Use Deno's built-in testing
  - Pros: TypeScript-first, no configuration needed
  - Cons: Requires Deno runtime, incompatible with existing Node.js setup

**Decision rationale**: Jest chosen for its maturity, extensive ecosystem, excellent TypeScript support via ts-jest, and proven compatibility with Node.js libraries.

# Security / Privacy / Compliance

- Tests MUST NOT contain real credentials, API keys, or sensitive data
- Test fixtures SHOULD use obviously fake values (e.g., "fake-project-id")
- Tests run in CI with minimal permissions (no cloud provider access needed)
- No PII or audit considerations for pure utility function testing

# Operational Notes

- **Cost**: Minimal - tests run in existing CI infrastructure
- **Observability**: Test results visible in GitHub Actions and `nix flake check` output
- **Quotas/limits**: No additional quotas needed for utility function testing
- **Rollout**: Gradual - start with one function, expand coverage incrementally
- **Backout**: Can disable tests by removing from `flake.nix` checks without affecting build

# Implementation Notes

**Phase 1**: Core infrastructure setup
- Add Jest to `flake.nix` devShell and checks
- Configure Jest in `packages/toolbox/package.json`
- Create test for `generateServiceAccountId`

**Phase 2**: Expand coverage (future)
- Add tests for other utility functions
- Consider integration testing patterns for Pulumi components

**Key files:**
- `flake.nix`: Add nodejs and jest to devShell, create checks.test
- `packages/toolbox/package.json`: Add jest, @types/jest, ts-jest dependencies
- `packages/toolbox/jest.config.js`: Jest configuration with TypeScript support
- `packages/toolbox/pulumi/*.test.ts`: Test files following Jest conventions

# References

- Jest documentation: https://jestjs.io/docs/getting-started
- TypeScript testing with Jest: https://jestjs.io/docs/getting-started#using-typescript
- Nix flake checks: https://nixos.wiki/wiki/Flakes#Output_schema
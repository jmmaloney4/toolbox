# Local GitHub Actions Testing with act

This directory contains integration tests for the ADR management workflow using [act](https://github.com/nektos/act).

## Prerequisites

1. Install act: `brew install act` (macOS) or see https://nektosact.com/installation/
2. Install Docker Desktop or compatible container runtime
3. Pull runner image: `docker pull catthehacker/ubuntu:act-latest`

## Usage

From the repository root:

```bash
# Test conflict detection (default)
./tests/act/run-adr-test.sh conflict

# Test successful ADR addition
./tests/act/run-adr-test.sh success

# Test no-ADR-files path
./tests/act/run-adr-test.sh no-adr
```

## What Gets Tested

| Scenario | What It Validates |
|----------|-------------------|
| `conflict` | Detects when a new ADR uses an already-taken number |
| `success` | Processes a new ADR with an available number |
| `no-adr` | Exits early when no new `.md` files are added |

## Limitations

- `gh` CLI calls will fail (no real GitHub token) — we verify the attempt via logs
- `git push` will fail (no remote) — we verify the commit was created
- Some GitHub-specific context may differ from real runs

## Cleanup

The script automatically cleans up the test branch and generated files on exit.
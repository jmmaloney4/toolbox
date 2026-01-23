#!/usr/bin/env bash
set -euo pipefail

#############################################
# Configuration
#############################################
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKFLOW=".github/workflows/adr-management.yml"
EVENT_TEMPLATE="$SCRIPT_DIR/pr-event.template.json"
EVENT_FILE="$SCRIPT_DIR/.pr-event.json"  # Generated, gitignored
TEST_BRANCH="test/act-adr-integration-$$"
DESIGNS_DIR="docs/internal/designs"
RUNNER_IMAGE="catthehacker/ubuntu:act-latest"
SKIP_CHECKOUT="${SKIP_CHECKOUT:-true}"

#############################################
# Cleanup trap
#############################################
cleanup() {
  echo "==> Cleaning up..."
  if [ -n "${ORIGINAL_REF:-}" ]; then
    git checkout "$ORIGINAL_REF" >/dev/null 2>&1 || true
  fi
  if git show-ref --verify --quiet "refs/heads/$TEST_BRANCH"; then
    git branch -D "$TEST_BRANCH" >/dev/null 2>&1 || true
  fi
  rm -f "$EVENT_FILE"
}
trap cleanup EXIT

#############################################
# Setup
#############################################
cd "$REPO_ROOT"

# Ensure we're in a git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: This script must be run inside a git repository."
  exit 1
fi

# Ensure we're on a clean state
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working directory has uncommitted changes. Commit or stash first."
  exit 1
fi

ORIGINAL_REF=$(git symbolic-ref --short -q HEAD || git rev-parse HEAD)
BASE_SHA=$(git rev-parse main)

echo "==> Creating test branch: $TEST_BRANCH"
git checkout -b "$TEST_BRANCH" >/dev/null

#############################################
# Scenario selection
#############################################
SCENARIO="${1:-conflict}"

case "$SCENARIO" in
  conflict)
    echo "==> Scenario: ADR number conflict"
    # Find an existing ADR number on main to conflict with
    EXISTING_NUM=$(ls "$DESIGNS_DIR" | grep -o '^[0-9]\{3\}' | sort -n | tail -1)
    TEST_FILE="$DESIGNS_DIR/${EXISTING_NUM}-test-conflict-adr.md"
    echo "# Test ADR for conflict scenario" > "$TEST_FILE"
    echo "This file intentionally uses existing number $EXISTING_NUM" >> "$TEST_FILE"
    git add "$TEST_FILE"
    git commit -m "test: add conflicting ADR $EXISTING_NUM for act test" >/dev/null
    TEST_SHA=$(git rev-parse HEAD)
    EXPECTED_LOG="CONFLICT: ADR number $EXISTING_NUM already exists"
    ;;
  
  success)
    echo "==> Scenario: New ADR without conflict"
    # Find next available number
    HIGHEST_NUM=$(ls "$DESIGNS_DIR" | grep -o '^[0-9]\{3\}' | sort -n | tail -1 || echo "000")
    NEXT_NUM=$(printf "%03d" $((10#$HIGHEST_NUM + 1)))
    TEST_FILE="$DESIGNS_DIR/${NEXT_NUM}-test-success-adr.md"
    echo "# Test ADR for success scenario" > "$TEST_FILE"
    git add "$TEST_FILE"
    git commit -m "test: add new ADR $NEXT_NUM for act test" >/dev/null
    TEST_SHA=$(git rev-parse HEAD)
    EXPECTED_LOG="OK: ADR number $NEXT_NUM is available"
    ;;
  
  no-adr)
    echo "==> Scenario: No new ADR files"
    # Touch a non-ADR file in designs
    echo "<!-- updated -->" >> "$DESIGNS_DIR/000-adr-template.md"
    git add "$DESIGNS_DIR/000-adr-template.md"
    git commit -m "test: modify template without adding new ADR" >/dev/null
    TEST_SHA=$(git rev-parse HEAD)
    EXPECTED_LOG="No new ADR files found"
    ;;
  
  *)
    echo "Usage: $0 [conflict|success|no-adr]"
    exit 1
    ;;
esac

#############################################
# Generate event JSON
#############################################
# For local act testing, always use the test commit SHA
# This ensures act works with local repository state
HEAD_SHA="$TEST_SHA"
HEAD_REF="$TEST_BRANCH"

echo "==> Generating event payload"
export HEAD_SHA HEAD_REF BASE_SHA
envsubst < "$EVENT_TEMPLATE" > "$EVENT_FILE"

echo "Event payload:"
cat "$EVENT_FILE"

#############################################
# Run act
#############################################
echo ""
echo "==> Running act..."
echo "    Workflow: $WORKFLOW"
echo "    Image: $RUNNER_IMAGE"
echo ""

# Capture output for assertion
ACT_OUTPUT=$(mktemp)

# Run act
# --artifact-server-path: disable artifact server (not needed)
# -j manage-adrs: run only this job
# -v: verbose output for debugging
# --container-architecture: explicitly set architecture for M-series Macs
# -C: use current directory as workspace (sets GITHUB_WORKSPACE)
# act automatically sets ACT=true, which skips checkout in the workflow
# We expect gh/git push to fail (no real remote), but we verify the logic ran
act pull_request \
  -W "$WORKFLOW" \
  -e "$EVENT_FILE" \
  -P ubuntu-latest="$RUNNER_IMAGE" \
  -j manage-adrs \
  --env GH_TOKEN=fake-token-for-local-test \
  --container-architecture linux/amd64 \
  -v \
  2>&1 | tee "$ACT_OUTPUT" || true

#############################################
# Assertions
#############################################
echo ""
echo "==> Checking assertions..."

PASS_COUNT=0
FAIL_COUNT=0
PASSED_ASSERTIONS=()
FAILED_ASSERTIONS=()

ASSERTION_NAME="expected log message"

if grep -q "$EXPECTED_LOG" "$ACT_OUTPUT"; then
  echo "✅ PASS: Found expected log message: '$EXPECTED_LOG'"
  PASS_COUNT=$((PASS_COUNT + 1))
  PASSED_ASSERTIONS+=("$ASSERTION_NAME")
  EXIT_CODE=0
else
  echo "❌ FAIL: Did not find expected log message: '$EXPECTED_LOG'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILED_ASSERTIONS+=("$ASSERTION_NAME")
  echo ""
  echo "--- Captured output ---"
  cat "$ACT_OUTPUT"
  EXIT_CODE=1
fi

echo ""
echo "==> Test summary"
echo "    Passed: $PASS_COUNT"
echo "    Failed: $FAIL_COUNT"
if [ ${#PASSED_ASSERTIONS[@]} -gt 0 ]; then
  echo "    Passed assertions: ${PASSED_ASSERTIONS[*]}"
else
  echo "    Passed assertions: None"
fi
if [ ${#FAILED_ASSERTIONS[@]} -gt 0 ]; then
  echo "    Failed assertions: ${FAILED_ASSERTIONS[*]}"
else
  echo "    Failed assertions: None"
fi

rm -f "$ACT_OUTPUT"
exit $EXIT_CODE

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
    # New workflow outputs: "CONFLICT: ADR XXX already exists on main: path/to/file"
    EXPECTED_LOG="CONFLICT: ADR $EXISTING_NUM already exists on main:"
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
    # New workflow outputs: "Created placeholder: path/to/file" from script.sh
    EXPECTED_LOG="Created placeholder:"
    ;;
  
  no-adr)
    echo "==> Scenario: No new ADR files (modify existing)"
    # Touch a non-ADR file in designs
    echo "<!-- updated -->" >> "$DESIGNS_DIR/000-adr-template.md"
    git add "$DESIGNS_DIR/000-adr-template.md"
    git commit -m "test: modify template without adding new ADR" >/dev/null
    TEST_SHA=$(git rev-parse HEAD)
    # New workflow outputs nothing special, just sets has_new_adrs=false
    EXPECTED_LOG="has_new_adrs=false"
    ;;
  
  *)
    echo "Usage: $0 [conflict|success|no-adr]"
    exit 1
    ;;
esac

#############################################
# Generate event JSON
#############################################
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
echo "    Scenario: $SCENARIO"
echo ""

# Capture output for assertion
ACT_OUTPUT=$(mktemp)

# Run act
# -j manage-adrs: run only this job
# -v: verbose output for debugging
# --container-architecture: explicitly set architecture for M-series Macs
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

# Assertion 1: Expected log message for the scenario
ASSERTION_NAME="expected log message for $SCENARIO scenario"

if grep -q "$EXPECTED_LOG" "$ACT_OUTPUT"; then
  echo "✅ PASS: Found expected log message: '$EXPECTED_LOG'"
  PASS_COUNT=$((PASS_COUNT + 1))
  PASSED_ASSERTIONS+=("$ASSERTION_NAME")
else
  echo "❌ FAIL: Did not find expected log message: '$EXPECTED_LOG'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILED_ASSERTIONS+=("$ASSERTION_NAME")
fi

# Assertion 2: For conflict scenario, verify gh pr comment was attempted
if [ "$SCENARIO" = "conflict" ]; then
  ASSERTION_NAME="gh pr comment attempted"
  if grep -q "gh pr comment" "$ACT_OUTPUT"; then
    echo "✅ PASS: gh pr comment was attempted"
    PASS_COUNT=$((PASS_COUNT + 1))
    PASSED_ASSERTIONS+=("$ASSERTION_NAME")
  else
    echo "❌ FAIL: gh pr comment was not attempted"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_ASSERTIONS+=("$ASSERTION_NAME")
  fi
fi

# Assertion 3: For success scenario, verify git push was attempted
if [ "$SCENARIO" = "success" ]; then
  ASSERTION_NAME="git push to main attempted"
  if grep -q "git push origin main" "$ACT_OUTPUT"; then
    echo "✅ PASS: git push to main was attempted"
    PASS_COUNT=$((PASS_COUNT + 1))
    PASSED_ASSERTIONS+=("$ASSERTION_NAME")
  else
    echo "❌ FAIL: git push to main was not attempted"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_ASSERTIONS+=("$ASSERTION_NAME")
  fi
fi

#############################################
# Summary
#############################################
echo ""
echo "==> Test summary"
echo "    Scenario: $SCENARIO"
echo "    Passed: $PASS_COUNT"
echo "    Failed: $FAIL_COUNT"
if [ ${#PASSED_ASSERTIONS[@]} -gt 0 ]; then
  echo "    Passed assertions:"
  for assertion in "${PASSED_ASSERTIONS[@]}"; do
    echo "      - $assertion"
  done
fi
if [ ${#FAILED_ASSERTIONS[@]} -gt 0 ]; then
  echo "    Failed assertions:"
  for assertion in "${FAILED_ASSERTIONS[@]}"; do
    echo "      - $assertion"
  done
  echo ""
  echo "--- Captured output (last 100 lines) ---"
  tail -100 "$ACT_OUTPUT"
fi

rm -f "$ACT_OUTPUT"

if [ $FAIL_COUNT -gt 0 ]; then
  exit 1
fi
exit 0

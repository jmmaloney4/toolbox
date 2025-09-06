#!/bin/bash
# Merge deployment markers into a single JSON array
# Arguments: none (operates on deploy-ok directory)

set -euo pipefail

echo "Merging deployment markers..."

files=$(find deploy-ok -type f -name '*.json' 2>/dev/null || true)
if [ -z "$files" ]; then
  stacks_json="[]"
  echo "No deployment markers found"
else
  stacks_json=$(jq -s '[.[]] | unique_by(.project + "|" + .stack)' $files)
  echo "Found deployment markers: $(echo "$files" | wc -l)"
fi

# Output for GitHub Actions
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "stacks=$stacks_json" >> "$GITHUB_OUTPUT"
fi

echo "Merged stacks JSON: $stacks_json"

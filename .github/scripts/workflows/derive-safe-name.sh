#!/bin/bash
# Derive artifact-safe name from project path
# Arguments:
#   $1 - Project path

set -euo pipefail

PROJECT_PATH="$1"

safe_name="$PROJECT_PATH"
safe_name="${safe_name//\//__}"

# Output for GitHub Actions
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "safe_name=$safe_name" >> "$GITHUB_OUTPUT"
fi

echo "Safe name: $safe_name"

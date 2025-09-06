#!/bin/bash
# Get Pulumi information and output to GitHub Actions
# Arguments:
#   $1 - Working directory (optional)
#   $2 - Enable GCP auth (true/false)
#   $3 - Enable AWS auth (true/false)

set -euo pipefail

WORKING_DIR="${1:-.}"
ENABLE_GCP_AUTH="${2:-false}"
ENABLE_AWS_AUTH="${3:-false}"

cd "$WORKING_DIR"

echo "Getting Pulumi information..."

# Write outputs from inside the devshell to avoid capturing banner noise
nix develop -c bash -lc '
  set -euo pipefail
  version=$(pulumi version)
  backend=$(pulumi whoami --url 2>/dev/null || echo "none")
  {
    echo "version=$version"
    echo "backend=$backend"
  } >> "$GITHUB_OUTPUT"
'

# Read back values for summary rendering
version=$(grep -E '^version=' "$GITHUB_OUTPUT" | tail -1 | cut -d= -f2-)
backend=$(grep -E '^backend=' "$GITHUB_OUTPUT" | tail -1 | cut -d= -f2-)

# Output info to summary
{
  echo "### ☁️ Pulumi Setup Complete"
  echo ""
  echo "- **Version:** $version"
  echo "- **Backend:** $backend"
  echo "- **Using Nix:** true"
  echo "- **Working Directory:** $WORKING_DIR"
  if [ "$ENABLE_GCP_AUTH" == "true" ]; then
    echo "- **GCP Auth:** ✅ Enabled"
  fi
  if [ "$ENABLE_AWS_AUTH" == "true" ]; then
    echo "- **AWS Auth:** ✅ Enabled"
  fi
} >> "$GITHUB_STEP_SUMMARY"

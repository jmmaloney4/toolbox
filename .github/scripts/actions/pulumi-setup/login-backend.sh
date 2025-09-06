#!/bin/bash
# Login to Pulumi backend
# Arguments:
#   $1 - Backend URL (optional)
#   $2 - Working directory (optional)

set -euo pipefail

BACKEND_URL="${1:-}"
WORKING_DIR="${2:-.}"
cd "$WORKING_DIR"

if [ -n "$BACKEND_URL" ]; then
  echo "Logging in to Pulumi backend: $BACKEND_URL"
  nix develop -c pulumi login "$BACKEND_URL"
elif [ -n "${PULUMI_ACCESS_TOKEN:-}" ]; then
  echo "Using Pulumi Cloud with access token"
  nix develop -c pulumi login
else
  echo "::warning::No Pulumi backend or access token configured"
fi

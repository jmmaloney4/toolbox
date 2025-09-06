#!/bin/bash
# Run Pulumi up (deploy) for a project/stack
# Arguments:
#   $1 - Project directory
#   $2 - Stack name

set -euo pipefail

PROJECT_DIR="$1"
STACK_NAME="$2"

echo "Running Pulumi deployment for project: $PROJECT_DIR, stack: $STACK_NAME"

cd "$PROJECT_DIR"
nix develop --command pulumi up --stack "$STACK_NAME" --yes --non-interactive

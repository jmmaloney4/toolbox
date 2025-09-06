#!/bin/bash
# Run Pulumi preview for a project/stack
# Arguments:
#   $1 - Project directory
#   $2 - Stack name

set -euo pipefail

PROJECT_DIR="$1"
STACK_NAME="$2"

echo "Running Pulumi preview for project: $PROJECT_DIR, stack: $STACK_NAME"

cd "$PROJECT_DIR"
nix develop --command pulumi preview --stack "$STACK_NAME" --non-interactive

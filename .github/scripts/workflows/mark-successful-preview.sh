#!/bin/bash
# Mark a successful preview by creating a marker file
# Arguments:
#   $1 - Project path
#   $2 - Stack name

set -euo pipefail

PROJECT_PATH="$1"
STACK_NAME="$2"

echo "Marking successful preview for project: $PROJECT_PATH, stack: $STACK_NAME"

mkdir -p ok
safe_name="$PROJECT_PATH"
safe_name="${safe_name//\//__}"

jq -n --arg project "$PROJECT_PATH" --arg stack "$STACK_NAME" \
  '{project:$project, stack:$stack}' > "ok/${safe_name}-${STACK_NAME}.json"

echo "Created success marker: ok/${safe_name}-${STACK_NAME}.json"

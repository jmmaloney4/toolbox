#!/bin/bash
# Mark a successful deployment by creating a marker file
# Arguments:
#   $1 - Project path
#   $2 - Stack name

set -euo pipefail

PROJECT_PATH="$1"
STACK_NAME="$2"

echo "Marking successful deployment for project: $PROJECT_PATH, stack: $STACK_NAME"

mkdir -p deployed
safe_name="$PROJECT_PATH"
safe_name="${safe_name//\//__}"

jq -n --arg project "$PROJECT_PATH" --arg stack "$STACK_NAME" \
  '{project:$project, stack:$stack, environment:$stack, success:true}' \
  > "deployed/${safe_name}-${STACK_NAME}.json"

echo "Created deployment marker: deployed/${safe_name}-${STACK_NAME}.json"

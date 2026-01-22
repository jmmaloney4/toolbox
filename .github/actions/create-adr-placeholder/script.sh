#!/usr/bin/env bash
set -euo pipefail

if [ -z "${SUCCESS_FILE:-}" ]; then
  echo "Error: SUCCESS_FILE environment variable is not set." >&2
  exit 1
fi
if [ -z "${PR_URL:-}" ]; then
  echo "Error: PR_URL environment variable is not set." >&2
  exit 1
fi

if [ ! -f "$SUCCESS_FILE" ]; then
  echo "Error: SUCCESS_FILE '$SUCCESS_FILE' does not exist or is not a regular file." >&2
  exit 1
fi

# Validate JSON format
if ! jq empty -- "$SUCCESS_FILE" 2>/dev/null; then
  echo "Error: SUCCESS_FILE '$SUCCESS_FILE' is not valid JSON" >&2
  exit 1
fi

# Path traversal protection: validate workspace root using git
WORKSPACE_ROOT=$(realpath -e .)
if [ ! -d "$WORKSPACE_ROOT/.git" ]; then
  echo "Error: Not in a git repository: '$WORKSPACE_ROOT'" >&2
  exit 1
fi

# Iterate over all entries in JSON array
jq -c '.[]' -- "$SUCCESS_FILE" | while IFS= read -r entry; do
  status=$(echo "$entry" | jq -r '.status')

  if [ "$status" = "OK" ]; then
    adr_file=$(echo "$entry" | jq -r '.file')
    adr_number=$(echo "$entry" | jq -r '.number')
    adr_filename=$(basename "$adr_file")
    current_date=$(date -u +%Y-%m-%d)

    # Validate adr_number is 3-digit numeric
    if [[ ! "$adr_number" =~ ^[0-9]{3}$ ]]; then
      echo "Error: Invalid ADR number '$adr_number' (must be 3-digit numeric)" >&2
      exit 1
    fi

    # Bash regex for title extraction with error handling
    if [[ "$adr_filename" =~ ^[0-9]{3}-(.*)\.md$ ]]; then
      slug="${BASH_REMATCH[1]}"
      adr_title=$(echo "$slug" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1')
    else
      echo "Warning: Filename '$adr_filename' does not match expected pattern XXX-title.md" >&2
      adr_title="Untitled ADR"
    fi

    # Path traversal protection: validate adr_file path is within docs/internal/designs/
    # Convert to absolute path for validation, but don't require file to exist yet
    if ! real_adr_file=$(realpath -m "$adr_file" 2>/dev/null); then
      echo "Error: File path '$adr_file' is invalid" >&2
      exit 1
    fi

    # Enforce directory boundary with trailing separator
    DESIGNS_DIR="$WORKSPACE_ROOT/docs/internal/designs"
    if [[ ! "$real_adr_file" =~ ^"$DESIGNS_DIR"/ ]]; then
      echo "Error: Path '$adr_file' is outside allowed directory 'docs/internal/designs/'" >&2
      exit 1
    fi

    # Create directory if needed
    adr_dir=$(dirname "$adr_file")
    mkdir -p "$adr_dir"

    # Create ADR file with YAML frontmatter using printf (prevents shell injection)
    printf '---
id: ADR-%s
title: %s
status: proposed
date: %s
---
' "$adr_number" "$adr_title" "$current_date" > "$adr_file"

    printf '# ADR %s: %s\n' "$adr_number" "$adr_title" >> "$adr_file"
    printf '*Date:* %s\n' "$current_date" >> "$adr_file"
    printf '*Status:* proposed\n\n' >> "$adr_file"
    printf '**Related PR:** %s\n\n' "$PR_URL" >> "$adr_file"
    printf 'This ADR is currently being developed in linked pull request above.\nPlease refer to that PR for current content and discussion.\n' >> "$adr_file"

    echo "Created placeholder: $adr_file"
  fi
done

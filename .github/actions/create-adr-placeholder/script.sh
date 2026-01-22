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

 # Validate we're operating within allowed workspace (path traversal protection)
 WORKSPACE_ROOT=$(realpath -e .)
 if [[ ! "$WORKSPACE_ROOT" =~ ^/tmp.*|^/home.*|^/Users.* ]]; then
  echo "Error: Unexpected workspace root '$WORKSPACE_ROOT'" >&2
  exit 1
fi

while read -r encoded_line || [[ -n "$encoded_line" ]]; do
  decoded_line=$(echo "$encoded_line" | base64 -d)
  IFS=: read -r adr_file adr_number status <<< "$decoded_line"
  status=$(echo "$status" | tr -d '\r')
  if [ "$status" = "OK" ]; then
    adr_filename=$(basename "$adr_file")
    current_date=$(date -u +%Y-%m-%d)

    # Bash regex for title extraction with error handling
    if [[ "$adr_filename" =~ ^[0-9]{3}-(.*)\.md$ ]]; then
      slug="${BASH_REMATCH[1]}"
      adr_title=$(echo "$slug" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1')
    else
      echo "Warning: Filename '$adr_filename' does not match expected pattern XXX-title.md" >&2
      adr_title="Untitled ADR"
    fi

    # Path traversal protection: resolve and validate adr_file is within workspace
    if ! real_adr_file=$(realpath -e "$adr_file" 2>/dev/null); then
      echo "Error: File '$adr_file' does not exist or cannot be resolved" >&2
      exit 1
    fi

    if [[ ! "$real_adr_file" =~ ^"$WORKSPACE_ROOT" ]]; then
      echo "Error: Path traversal detected: '$real_adr_file' is outside workspace '$WORKSPACE_ROOT'" >&2
      exit 1
    fi

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
  fi
done < "$SUCCESS_FILE"

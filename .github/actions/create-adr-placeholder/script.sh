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

while IFS=: read -r adr_file adr_number status || [[ -n "$adr_file" ]]; do
  status=$(echo "$status" | tr -d '\r')
  if [ "$status" = "OK" ]; then
    adr_filename=$(basename "$adr_file")
    current_date=$(date -u +%Y-%m-%d)
    adr_title=$(echo "$adr_filename" | sed 's/^[0-9]\{3\}-//' | sed 's/\.md$//' | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1')

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

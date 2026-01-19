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
    adr_title=$(echo "$adr_filename" | sed 's/^[0-9]\{3\}-//' | sed 's/\.md$//' | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1')
    content="# ADR $adr_number: $adr_title
*Date:* $(date -u +%Y-%m-%d)
*Status:* proposed

**Related PR:** $PR_URL

This ADR is currently being developed in the linked pull request above.
Please refer to that PR for current content and discussion."
    echo "$content" > "$adr_file"
  fi
done < "$SUCCESS_FILE"

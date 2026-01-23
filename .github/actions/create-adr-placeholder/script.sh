#!/usr/bin/env bash
set -euo pipefail

ADR_FILES="${ADR_FILES:?ADR_FILES env var is required}"
PR_URL="${PR_URL:?PR_URL env var is required}"
BASE_BRANCH="${BASE_BRANCH:-main}"

if [ ! -f "$ADR_FILES" ]; then
  echo "Error: ADR_FILES '$ADR_FILES' does not exist" >&2
  exit 1
fi

# Configure git for commits
git config user.name "GitHub Actions ADR Bot"
git config user.email "actions@github.com"

# Fetch latest base branch to reduce race condition window
git fetch origin "${BASE_BRANCH}"
git checkout "origin/${BASE_BRANCH}" -b main-placeholder

current_date=$(date -u +%Y-%m-%d)

while IFS= read -r adr_file; do
  [ -z "$adr_file" ] && continue

  # Security: Prevent path traversal and validate path
  if echo "$adr_file" | grep -q '\.\.'; then
    echo "Error: Unsafe ADR file path (contains '..'): $adr_file" >&2
    continue
  fi
  
  # Validate path is within repository bounds and doesn't start with /
  if [[ "$adr_file" =~ ^/ ]] || [[ ! "$adr_file" =~ ^[^/][^/]*/[^/].*\.md$ ]]; then
    echo "Error: Invalid ADR file path format: $adr_file" >&2
    echo "Expected: relative path to .md file (e.g., 'docs/adr/001-my-adr.md')" >&2
    continue
  fi
  adr_filename=$(basename "$adr_file")
  adr_number=$(echo "$adr_filename" | grep -o '^[0-9]\{3\}' || echo "")
  if [ -z "$adr_number" ]; then
    echo "Warning: Could not extract ADR number from $adr_filename, skipping"
    continue
  fi
  # Extract title from filename (e.g., 001-my-title.md -> My Title)
  if [[ "$adr_filename" =~ ^[0-9]{3}-(.*)\.md$ ]] && [ -n "${BASH_REMATCH[1]}" ]; then
    slug="${BASH_REMATCH[1]}"
    adr_title=$(echo "$slug" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1')
  else
    adr_title="Untitled ADR"
  fi
  # Create directory if needed
  mkdir -p "$(dirname "$adr_file")"
  # Create placeholder file
  cat > "$adr_file" << EOF
---
id: ADR-${adr_number}
title: "${adr_title}"
status: proposed
date: ${current_date}
---

# ADR ${adr_number}: ${adr_title}
*Date:* ${current_date}
*Status:* proposed

**Related PR:** ${PR_URL}

This ADR is currently being developed in linked pull request above.
Please refer to that PR for current content and discussion.
EOF
  git add "$adr_file"
  echo "Created placeholder: $adr_file"
done < "$ADR_FILES"

# Commit and push if there are changes
if git diff --cached --quiet; then
  echo "No changes to commit"
else
  git commit -m "Reserve ADR number(s) for PR

Related PR: ${PR_URL}"
  git push origin "main-placeholder:${BASE_BRANCH}"
  echo "Pushed placeholder(s) to ${BASE_BRANCH}"
fi
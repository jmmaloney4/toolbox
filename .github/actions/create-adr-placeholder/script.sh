#!/usr/bin/env bash
set -euo pipefail

ADR_FILES="${ADR_FILES:?ADR_FILES env var is required}"
PR_URL="${PR_URL:?PR_URL env var is required}"
BASE_BRANCH="${BASE_BRANCH:-main}"
MAX_RETRIES="${MAX_RETRIES:-4}"

if [ ! -f "$ADR_FILES" ]; then
  echo "Error: ADR_FILES '$ADR_FILES' does not exist" >&2
  exit 1
fi

# Configure git for commits
git config user.name "GitHub Actions ADR Bot"
git config user.email "actions@github.com"

# push_with_retry: attempt git push, retrying on non-fast-forward failures.
# On each failure the function fetches the latest base branch, rebases the
# placeholder branch, sleeps with exponential backoff, then retries.
# Backoff delays (seconds): 30, 60, 120, 240 (doubles each attempt).
# Usage: push_with_retry <src-branch> <dst-branch>
push_with_retry() {
  local src_branch="${1:?push_with_retry requires src branch}"
  local dst_branch="${2:?push_with_retry requires dst branch}"
  local attempt=1
  local delay=30

  while true; do
    echo "Push attempt ${attempt}/${MAX_RETRIES}…"
    if git push origin "${src_branch}:${dst_branch}"; then
      return 0
    fi

    if [ "$attempt" -ge "$MAX_RETRIES" ]; then
      echo "Error: git push failed after ${MAX_RETRIES} attempts. Giving up." >&2
      return 1
    fi

    echo "Push failed (attempt ${attempt}). Waiting ${delay}s before retry…"
    sleep "$delay"

    echo "Fetching latest ${dst_branch} and rebasing…"
    if ! git fetch origin "${dst_branch}"; then
      echo "Error: git fetch failed during retry ${attempt}. Aborting." >&2
      return 1
    fi
    if ! git rebase "origin/${dst_branch}"; then
      echo "Error: git rebase failed during retry ${attempt} (possible conflict on ${dst_branch})." >&2
      echo "Check the workflow logs for details, or reproduce locally:" >&2
      echo "  git fetch origin ${dst_branch} && git rebase origin/${dst_branch}" >&2
      return 1
    fi

    attempt=$(( attempt + 1 ))
    delay=$(( delay * 2 ))
  done
}

# Fetch latest base branch to reduce race condition window
git fetch origin "${BASE_BRANCH}"
git checkout "origin/${BASE_BRANCH}" -b "${BASE_BRANCH}-placeholder"

current_date=$(date -u +%Y-%m-%d)

while IFS= read -r adr_file; do
  [ -z "$adr_file" ] && continue

  # Security: Prevent path traversal and validate path
  # 1. Prevent directory traversal (../) anywhere in path
  if [[ "$adr_file" =~ (^|/)\.\.(/|$) ]]; then
    printf "Error: Unsafe ADR file path (contains '..'): %s\n" "$adr_file" >&2
    continue
  fi
  
  # 2. Must be a relative path to a markdown file (optionally with directories)
  # Regex allows: 'foo.md', 'dir/foo.md', 'dir/subdir/foo.md'
  # Rejects: '/foo.md' (absolute), 'foo.txt' (wrong extension)
  if [[ "$adr_file" =~ ^/ ]] || [[ ! "$adr_file" =~ ^([^/].*/)*[^/]+\.md$ ]]; then
    printf "Error: Invalid ADR file path format: %s\n" "$adr_file" >&2
    printf "Expected: relative path to .md file (e.g., 'docs/adr/001.md')\n" >&2
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
  push_with_retry "${BASE_BRANCH}-placeholder" "${BASE_BRANCH}"
  echo "Pushed placeholder(s) to ${BASE_BRANCH}"
fi

#!/usr/bin/env bash
set -euo pipefail

CONFLICTS_FILE="${CONFLICTS_FILE:-/tmp/adr_conflicts.json}"
PR_NUMBER="${PR_NUMBER:?PR_NUMBER env var is required}"
PR_HEAD_REF="${PR_HEAD_REF:?PR_HEAD_REF env var is required}"
PR_HEAD_SHA="${PR_HEAD_SHA:?PR_HEAD_SHA env var is required}"
PR_URL="${PR_URL:?PR_URL env var is required}"

if [ ! -s "$CONFLICTS_FILE" ]; then
  echo "No conflicting ADRs to process"
  exit 0
fi

if ! jq empty "$CONFLICTS_FILE" 2>/dev/null; then
  echo "CRITICAL: $CONFLICTS_FILE is not valid JSON" >&2
  exit 1
fi

git checkout main
HIGHEST_NUM=$(ls docs/internal/designs/ | grep -o '^[0-9]\{3\}' | sort -n | tail -1 || echo "000")

if [[ ! "$HIGHEST_NUM" =~ ^[0-9]{3}$ ]]; then
  echo "CRITICAL: Invalid ADR number format: '$HIGHEST_NUM'" >&2
  exit 1
fi

NEXT_NUM=$(printf "%03d" $((10#$HIGHEST_NUM + 1)))

git checkout "$PR_HEAD_SHA"

jq -c '.[]' "$CONFLICTS_FILE" | while IFS= read -r entry; do
  status=$(echo "$entry" | jq -r '.status')
  if [ "$status" = "CONFLICT" ]; then
    adr_file=$(echo "$entry" | jq -r '.file')
    adr_number=$(echo "$entry" | jq -r '.number')
    existing_file=$(echo "$entry" | jq -r '.existing_file')

    echo "Handling conflict for $adr_file (number $adr_number)"

    gh pr comment "$PR_NUMBER" --body "⚠️ **ADR Number Conflict Detected**

The ADR file \`$adr_file\` uses number \`$adr_number\` which is already taken on the main branch.

I'm automatically creating a PR to rename this file to use the next available number \`$NEXT_NUM\`.

**Original file:** \`$adr_file\`
**Suggested rename:** \`$(dirname "$adr_file")/$NEXT_NUM-$(basename "$adr_file" | sed "s/^$adr_number-//")\`

**Conflict:** ADR number \`$adr_number\` is already in use on the main branch
**Solution:** Rename the ADR in this PR to use number \`$NEXT_NUM\`

**Next Steps:**
1. Review and merge this renaming PR into the parent branch
2. The parent PR will be automatically re-processed with the corrected number
3. A placeholder PR will be created against the main branch with the new number"

    renaming_branch="adr-rename/$adr_number-to-$NEXT_NUM"
    existing_renaming_pr=$(gh pr list --base "$PR_HEAD_REF" --head "$renaming_branch" --json number --jq '.[0].number // empty' 2>/dev/null || echo "")

    if [ -n "$existing_renaming_pr" ]; then
      echo "Renaming PR already exists for ADR $adr_number -> $NEXT_NUM (PR #$existing_renaming_pr). Skipping creation."
      continue
    fi

    git checkout -b "$renaming_branch"

    old_filename=$(basename "$adr_file")
    new_filename=$(echo "$old_filename" | sed "s/^$adr_number-/$NEXT_NUM/")

    adr_dir=$(dirname "$adr_file")
    git mv "$adr_file" "$adr_dir/$new_filename"

    sed -i "s/ADR-$adr_number/ADR-$NEXT_NUM/g" "$adr_dir/$new_filename"
    sed -i "s/ADR-$adr_number\(/ADR-$NEXT_NUM/g" "$adr_dir/$new_filename"

    git add "$adr_dir/$new_filename"
    git commit -m "Rename ADR from $adr_number to $NEXT_NUM to resolve conflict

**Original file:** \`$adr_file\`
**Suggested rename:** \`$(dirname "$adr_file")/$NEXT_NUM-$(basename "$adr_file" | sed "s/^$adr_number-//")\`

**Conflict:** ADR number \`$adr_number\` is already in use on the main branch
**Solution:** Rename the ADR in this PR to use number \`$NEXT_NUM\`

**Changes:**
- Renamed \`$adr_file\` to \`$(dirname "$adr_file")/$NEXT_NUM-$(basename "$adr_file" | sed "s/^$adr_number-//")\`
- Updated internal references from ADR-$adr_number to ADR-$NEXT_NUM
- Created \`$adr_dir/$new_filename\` with new number $NEXT_NUM
- Updated internal references to ADR-$NEXT_NUM

The parent PR will be automatically re-processed with the corrected number."

    gh pr create \
      --title "Rename ADR from $adr_number to $NEXT_NUM (conflict resolution)" \
      --body "This PR automatically resolves an ADR number conflict detected in the parent PR.

**Conflict:** ADR number \`$adr_number\` is already in use on the main branch
**Solution:** Rename the ADR in the parent PR to use the next available number \`$NEXT_NUM\`.

**Original file:** \`$adr_file\`
**Suggested rename:** \`$(dirname "$adr_file")/$NEXT_NUM-$(basename "$adr_file" | sed "s/^$adr_number-//")\`

**Changes:**
- Renamed \`$adr_file\` to \`$(dirname "$adr_file")/$NEXT_NUM-$(basename "$adr_file" | sed "s/^$adr_number-//")\`
- Updated internal references from ADR-$adr_number to ADR-$NEXT_NUM
- Created \`$adr_dir/$new_filename\` with new number $NEXT_NUM
- Updated internal references to ADR-$NEXT_NUM

The parent PR will be automatically re-processed with the corrected number."

    git push origin "$renaming_branch" --force-with-lease

    NEXT_NUM=$(printf "%03d" $((10#$NEXT_NUM + 1)))
  fi
done

#!/usr/bin/env bash
set -euo pipefail

if [ -z "${ADR_FILES:-}" ] || [ ! -f "${ADR_FILES:-}" ]; then
  echo "ADR file list is missing: ${ADR_FILES:-<unset>}" >&2
  exit 1
fi

if [ -z "${BASE_REF:-}" ] || [ -z "${ADR_GLOB:-}" ] || [ -z "${PR_NUMBER:-}" ]; then
  echo "BASE_REF, ADR_GLOB, and PR_NUMBER are required" >&2
  exit 1
fi

declare -A seen_numbers=()
has_conflict=false
conflict_messages=""

base_adr_paths=$(git ls-tree -r --name-only "origin/${BASE_REF}" -- "${ADR_GLOB}" 2>/dev/null || true)

while IFS= read -r adr_file; do
  [ -z "$adr_file" ] && continue

  adr_filename=$(basename "$adr_file")
  adr_number=$(printf '%s' "$adr_filename" | grep -Eo '^[0-9]{3}' || true)

  if [ -z "$adr_number" ]; then
    echo "Warning: Could not extract ADR number from ${adr_filename}"
    continue
  fi

  if [ -n "${seen_numbers[$adr_number]:-}" ]; then
    echo "DUPLICATE: ADR ${adr_number} appears multiple times in this PR"
    has_conflict=true
    conflict_messages="${conflict_messages}- \`${adr_file}\` uses number \`${adr_number}\` which is duplicated in this PR\n"
  fi
  seen_numbers[$adr_number]=1

  existing=$(
    printf '%s\n' "${base_adr_paths}" | grep -E "(^|/)${adr_number}([^0-9]|$)" | head -1 || true
  )

  if [ -n "$existing" ]; then
    echo "CONFLICT: ADR ${adr_number} already exists on ${BASE_REF}: ${existing}"
    has_conflict=true
    conflict_messages="${conflict_messages}- \`${adr_file}\` uses number \`${adr_number}\` which conflicts with \`${existing}\`\n"
  fi
done < "$ADR_FILES"

if [ "$has_conflict" = "true" ]; then
  echo "has_conflict=true" >> "$GITHUB_OUTPUT"

  cat <<EOF > /tmp/conflict_comment.md
## ADR Number Conflict

One or more ADR files in this PR use numbers that already exist on base branch \`${BASE_REF}\`:

$(printf '%b' "$conflict_messages")

Please rename your ADR file(s) to use an available number and push again.
EOF

  gh pr comment "$PR_NUMBER" --body-file /tmp/conflict_comment.md
  exit 1
fi

echo "No ADR number conflicts found"
echo "has_conflict=false" >> "$GITHUB_OUTPUT"

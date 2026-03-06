#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASE_REF:-}" ] || [ -z "${ADR_GLOB:-}" ] || [ -z "${PR_NUMBER:-}" ]; then
  echo "BASE_REF, ADR_GLOB, and PR_NUMBER are required" >&2
  exit 1
fi

if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "PR_NUMBER must be numeric" >&2
  exit 1
fi

case "$BASE_REF$ADR_GLOB" in
  *$'\n'*|*$'\r'*)
    echo "BASE_REF and ADR_GLOB must not contain newlines" >&2
    exit 1
    ;;
esac

# ── Full-tree uniqueness audit (FM-1 / FM-3 fix) ─────────────────────────────
# Scan ALL files matching the glob that exist in the working tree (i.e. the
# PR's current tree), not just files added by this PR. This catches:
#   - pre-existing conflicts already on main (FM-1)
#   - conflicts among files that were never "new" from git's perspective (FM-3)

echo "Running full-tree ADR uniqueness audit (glob: ${ADR_GLOB})"

declare -A number_to_files=()
has_conflict=false
conflict_messages=""

# Collect all matching ADR files from the working tree
while IFS= read -r adr_file; do
  [ -z "$adr_file" ] && continue

  adr_filename=$(basename "$adr_file")
  adr_number=""
  if [[ "$adr_filename" =~ ^([0-9]{3})($|[^0-9]) ]]; then
    adr_number="${BASH_REMATCH[1]}"
  fi

  if [ -z "$adr_number" ]; then
    echo "Warning: Could not extract ADR number from ${adr_filename}"
    continue
  fi

  if [ -n "${number_to_files[$adr_number]:-}" ]; then
    number_to_files[$adr_number]="${number_to_files[$adr_number]}|${adr_file}"
  else
    number_to_files[$adr_number]="${adr_file}"
  fi
done < <(find . -path "./${ADR_GLOB}" -name '*.md' 2>/dev/null | sed 's|^\./||' | sort)

# Report any number with more than one file
for adr_number in "${!number_to_files[@]}"; do
  files_for_number="${number_to_files[$adr_number]}"
  # Split pipe-delimited list into an array — no subprocesses needed
  IFS='|' read -ra files_array <<< "$files_for_number"
  count=${#files_array[@]}
  if [ "$count" -gt 1 ]; then
    echo "CONFLICT: ADR number ${adr_number} is used by ${count} files: ${files_for_number}"
    has_conflict=true
    for f in "${files_array[@]}"; do
      conflict_messages="${conflict_messages}- \`${f}\` uses number \`${adr_number}\` (${count}-way conflict)\n"
    done
  fi
done

if [ "$has_conflict" = "true" ]; then
  echo "has_conflict=true" >> "$GITHUB_OUTPUT"

  comment_file=$(mktemp)
  trap 'rm -f "$comment_file"' EXIT

  {
    printf '## ADR Number Conflict\n\n'
    printf 'The following ADR number conflicts were detected by a full-tree audit\n'
    printf '(all files matching `%s` in this PR'\''s tree):\n\n' "$ADR_GLOB"
    printf '%b' "$conflict_messages"
    printf '\nPlease rename the conflicting ADR file(s) to use a unique number and push again.\n'
  } > "$comment_file"

  gh pr comment "$PR_NUMBER" --body-file "$comment_file"

  rm -f "$comment_file"
  trap - EXIT
  exit 1
fi

echo "No ADR number conflicts found (full-tree audit passed)"
echo "has_conflict=false" >> "$GITHUB_OUTPUT"

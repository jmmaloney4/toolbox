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

# Build a set of files that were added or modified by this PR (vs BASE_REF)
declare -A pr_files=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  pr_files["$f"]=1
done < <(git diff --name-only "origin/${BASE_REF}" HEAD -- "${ADR_GLOB}" 2>/dev/null || true)

declare -A number_to_files=()
has_conflict=false

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
done < <(find . -path "./${ADR_GLOB#./}" -name '*.md' | sed 's|^\./||' | sort)

# Build the conflict report grouped by ADR number
conflict_body=""
for adr_number in $(echo "${!number_to_files[@]}" | tr ' ' '\n' | sort); do
  files_for_number="${number_to_files[$adr_number]}"
  IFS='|' read -ra files_array <<< "$files_for_number"
  count=${#files_array[@]}
  if [ "$count" -gt 1 ]; then
    echo "CONFLICT: ADR number ${adr_number} is used by ${count} files: ${files_for_number}"
    has_conflict=true

    conflict_body="${conflict_body}### Number \`${adr_number}\` (${count}-way conflict)\n\n"
    for f in "${files_array[@]}"; do
      if [ -n "${pr_files[$f]:-}" ]; then
        label="PR branch"
      else
        label="\`${BASE_REF}\`"
      fi
      conflict_body="${conflict_body}- \`${f}\` — ${label}\n"
    done
    conflict_body="${conflict_body}\n"
  fi
done

if [ "$has_conflict" = "true" ]; then
  echo "has_conflict=true" >> "$GITHUB_OUTPUT"

  comment_file=$(mktemp)
  trap 'rm -f "$comment_file"' EXIT

  {
    printf '## ADR Number Conflicts\n\n'
    printf 'The following ADR number conflicts were detected by a full-tree audit\n'
    printf '(all files matching `%s` in this PR'\''s tree):\n\n' "$ADR_GLOB"
    printf '%b' "$conflict_body"
    printf 'Please rename the conflicting ADR file(s) to use a unique number and push again.\n'
  } > "$comment_file"

  gh pr comment "$PR_NUMBER" --body-file "$comment_file"

  rm -f "$comment_file"
  trap - EXIT
  exit 1
fi

echo "No ADR number conflicts found (full-tree audit passed)"
echo "has_conflict=false" >> "$GITHUB_OUTPUT"

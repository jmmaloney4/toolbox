#!/usr/bin/env bash
set -euo pipefail
project="$1"
stack="$2"
safe="$3"

printf "<!-- pulumi-%s-summary -->\n" "$stack"
printf "## Pulumi preview for %s (%s)\n\n" "$project" "$stack"

if [[ -f "previews/${safe}.txt" ]]; then
  echo "<details><summary>Diff (${safe}.txt)</summary>"
  echo ""
  echo '```text'
  # strip ANSI
  sed -e 's/\x1b\[[0-9;]*m//g' "previews/${safe}.txt" || true
  echo '```'
  echo "</details>"
else
  echo "_No preview diff found for ${safe}.txt._"
fi

if [[ -f "previews/${safe}.json" ]]; then
  echo "<details><summary>JSON (${safe}.json)</summary>"
  echo ""
  echo '```json'
  cat "previews/${safe}.json" || true
  echo '```'
  echo "</details>"
fi

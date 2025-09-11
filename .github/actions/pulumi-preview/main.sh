#!/usr/bin/env bash
set -euo pipefail

project="${PROJECT:?PROJECT is required}"
stack="${STACK:?STACK is required}"
safe_name_input="${SAFE_NAME_IN:-}" 

safe_name="$safe_name_input"
if [[ -z "$safe_name" ]]; then
  safe_name="$project"
fi
safe_name="${safe_name//\//__}"

export DEVSHELL_NO_MOTD=1
export DEVSHELL_NO_GREETING=1
export DEVSHELL_QUIET=1

mkdir -p previews ok

# Human-readable diff output
nix develop .#pulumi --command pulumi preview -C "$project" --stack "$stack" --non-interactive --diff | tee "previews/${safe_name}.txt"

# Optional JSON, tolerate failure to keep previews robust
if nix develop .#pulumi --command pulumi preview -C "$project" --stack "$stack" --non-interactive --json > "previews/${safe_name}.json"; then
  :
else
  echo "JSON preview failed or unsupported; continuing with text preview only" >&2
fi

# Render a markdown summary suitable for PR comments
bash "$GITHUB_ACTION_PATH/render_preview_summary.sh" "$project" "$stack" "$safe_name" > stage-preview-summary.md || true

# Compute whether there are changes (best effort) and emit OK marker
has_changes=false
if [[ -f "previews/${safe_name}.json" ]]; then
  if nix develop .#pulumi --command jq -e '((.changeSummary.create // 0) + (.changeSummary.update // 0) + (.changeSummary.replace // 0) + (.changeSummary.delete // 0)) > 0' "previews/${safe_name}.json" > /dev/null; then
    has_changes=true
  fi
fi

echo "has_changes=$has_changes" >> "$GITHUB_OUTPUT"

# Always create an OK marker on successful preview run of this action
nix develop .#pulumi --command jq -n --arg project "$project" --arg stack "$stack" --arg has_changes "$has_changes" \
  '{project:$project, stack:$stack, has_changes: ($has_changes=="true")}' > "ok/${safe_name}.json"

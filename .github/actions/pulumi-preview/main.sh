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

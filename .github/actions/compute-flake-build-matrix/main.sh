#!/usr/bin/env bash
set -euo pipefail

# Detect current Nix system (e.g., aarch64-darwin, x86_64-linux)
system="$(nix eval --impure --raw --expr 'builtins.currentSystem')"
echo "System: $system"

# Cache flake metadata once to avoid repeated 'nix flake show' calls
flake_meta_json_tmp="$(mktemp)"
nix -L flake show --json > "$flake_meta_json_tmp"

# Helper: evaluate selected outputs (packages, checks, devShells) for a system with cache status
selected_for_system() {
  local system_="$1"

  echo "nix-eval-jobs (selected): packages|checks|devShells for $system_" >&2

  # Evaluate each category separately and combine the results
  local all_outputs=""
  
  # Evaluate packages
  if packages_out=$(timeout "${PROBE_TIMEOUT_SECONDS}s" nix -L run nixpkgs#nix-eval-jobs -- \
        --check-cache-status \
        --flake . \
        --select "flake: flake.outputs.packages.\"$system_\" or {}" 2>/dev/null); then
    if [ -n "$packages_out" ]; then
      # Add category information to each output
      packages_out=$(printf '%s' "$packages_out" | jq -c '. + {category: "packages"}')
      all_outputs="$all_outputs$packages_out"$'\n'
    fi
  fi
  
  # Evaluate checks
  if checks_out=$(timeout "${PROBE_TIMEOUT_SECONDS}s" nix -L run nixpkgs#nix-eval-jobs -- \
        --check-cache-status \
        --flake . \
        --select "flake: flake.outputs.checks.\"$system_\" or {}" 2>/dev/null); then
    if [ -n "$checks_out" ]; then
      # Add category information to each output
      checks_out=$(printf '%s' "$checks_out" | jq -c '. + {category: "checks"}')
      all_outputs="$all_outputs$checks_out"$'\n'
    fi
  fi
  
  # Evaluate devShells
  if devshells_out=$(timeout "${PROBE_TIMEOUT_SECONDS}s" nix -L run nixpkgs#nix-eval-jobs -- \
        --check-cache-status \
        --flake . \
        --select "flake: flake.outputs.devShells.\"$system_\" or {}" 2>/dev/null); then
    if [ -n "$devshells_out" ]; then
      # Add category information to each output
      devshells_out=$(printf '%s' "$devshells_out" | jq -c '. + {category: "devShells"}')
      all_outputs="$all_outputs$devshells_out"$'\n'
    fi
  fi
  
  if [ -z "$all_outputs" ]; then
    echo "::error title=Evaluation failed::nix-eval-jobs failed for selected outputs" >&2
    return 1
  fi
  
  # Map nix-eval-jobs JSON to our unified row format
  printf '%s' "$all_outputs" \
    | nix -L run nixpkgs#jq -- -rc \
        --arg system "$system_" '
          . as $i
          | ($i.attr // "default") as $attr
          | ($i.category // "unknown") as $category
          | {
              category: $category,
              system: $system,
              name: $attr,
              flake_attr: (".#" + $category + "." + $system + "." + $attr),
              cached: ((.cacheStatus=="cached") or (.cached==true) or (.isCached==true)),
              store_path: (.outputs.out // "unknown")
            }
        '
}

# Collect all outputs (for summary) into a temp file
tmp_all="$(mktemp)"
selected_for_system "$system" > "$tmp_all"

# Build an array of all detected outputs (for summary)
all_outputs=$(nix -L run nixpkgs#jq -- -sc '[.[]]' "$tmp_all")
echo "All detected outputs: $all_outputs"

# Build include array from only uncached outputs
include_array=$(nix -L run nixpkgs#jq -- -sc 'map(select(.cached==false) | {category, system, name, flake_attr})' "$tmp_all")
echo "Computed include (uncached only): $include_array"

# Compute boolean flag indicating whether there is any work to do
has_work=$(nix -L run nixpkgs#jq -- -rc 'if (length>0) then "true" else "false" end' <<<"$include_array")
echo "Has work: $has_work"

# Expose outputs for downstream jobs
delim="MATRIX_INCLUDE_$(date +%s)"
{
  echo "matrix_include<<$delim"
  echo "$include_array"
  echo "$delim"
} >> "$GITHUB_OUTPUT"
echo "has_work=$has_work" >> "$GITHUB_OUTPUT"

# Cleanup temp files
rm -f "$tmp_all" "$flake_meta_json_tmp"

# Write a human-readable summary to the GitHub Actions run summary
{
  echo "### Detected flake outputs"
  if [ -n "$all_outputs" ] && [ "$all_outputs" != "null" ] && [ "$all_outputs" != "[]" ]; then
    # Render a markdown table listing all outputs and whether they are cached
    nix -L run nixpkgs#jq -- -rc '
      ["| Category | System | Name | Attr | Store Path | Cached |",
       "|---|---|---|---|---|---|"]
      + ( .
          | map("| " + .category + " | " + .system + " | **" + .name + "** | " + .flake_attr + " | `" + .store_path + "` | " + (if .cached then "📦  yes" else "🏗️  no" end) + " |")
        )
      | .[]
    ' <<<"$all_outputs"
  else
    echo "No outputs detected for this system."
  fi
  echo
} >> "$GITHUB_STEP_SUMMARY"



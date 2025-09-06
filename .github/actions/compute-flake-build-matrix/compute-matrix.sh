#!/usr/bin/env bash
set -euo pipefail

# Detect current Nix system (e.g., aarch64-darwin, x86_64-linux)
system="$(nix eval --impure --raw --expr 'builtins.currentSystem')"
echo "System: $system"

# Cache flake metadata once to avoid repeated 'nix flake show' calls
flake_meta_json_tmp="$(mktemp)"
nix -L flake show --json > "$flake_meta_json_tmp"

# Helper: stream all attributes for a category/system as JSON with cache status
all_for() {
  local category="$1"
  local system_="$2"
  local target=".#${category}.${system_}"

  echo "nix-eval-jobs: $target" >&2

  # Only evaluate categories that actually exist for this system; ignore others
  local cat_exists sys_exists
  cat_exists=$(nix -L eval --impure --raw --expr "let fl = builtins.getFlake (toString ./.); in if (builtins.hasAttr \"${category}\" fl) then \"1\" else \"0\"")
  if [ "$cat_exists" != "1" ]; then
    return 0
  fi
  sys_exists=$(nix -L eval --impure --raw --expr "let fl = builtins.getFlake (toString ./.); in if (builtins.hasAttr \"${system_}\" fl.${category}) then \"1\" else \"0\"")
  if [ "$sys_exists" != "1" ]; then
    return 0
  fi

  # Query cache status; fail fast on errors
  if ! out=$(timeout "${PROBE_TIMEOUT_SECONDS}s" nix -L run nixpkgs#nix-eval-jobs -- --check-cache-status --flake "$target"); then
    echo "::error title=Evaluation failed::nix-eval-jobs failed for $target" >&2
    return 1
  fi

  # Get store paths for all attributes in this category/system
  local store_paths_json
  store_paths_json=$(nix -L eval --json --expr "
    let
      flake = builtins.getFlake (toString ./.);
      attrs = flake.${category}.${system_};
    in
      builtins.mapAttrs (name: drv:
        if builtins.isDerivation drv then drv.outPath or \"unknown\"
        else \"not-a-derivation\"
      ) attrs
  " 2>/dev/null || echo '{}')

  # Emit JSON lines with cache status, full flake attribute, and store path
  printf '%s' "$out" \
    | nix -L run nixpkgs#jq -- -rc \
        --arg category "$category" \
        --arg system "$system_" \
        --argjson store_paths "$store_paths_json" '
          {
            category: $category,
            system: $system,
            name: (.attr // "default"),
            flake_attr: (".#" + $category + "." + $system + "." + (.attr // "default")),
            cached: ((.cacheStatus=="cached") or (.cached==true) or (.isCached==true)),
            store_path: ($store_paths[.attr // "default"] // "unknown")
          }
        '
}

# Collect all outputs (for summary) into a temp file
tmp_all="$(mktemp)"
nix -L run nixpkgs#jq -- -r 'keys[]' "$flake_meta_json_tmp" \
  | while IFS= read -r category; do
      all_for "$category" "$system"
    done > "$tmp_all"

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



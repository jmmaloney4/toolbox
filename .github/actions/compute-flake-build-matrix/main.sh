#!/usr/bin/env bash
set -euo pipefail

# Detect current Nix system (e.g., aarch64-darwin, x86_64-linux)
system="$(nix eval --impure --raw --expr 'builtins.currentSystem')"
echo "System: $system"

# Set probe timeout from input or default
PROBE_TIMEOUT_SECONDS="${PROBE_TIMEOUT_SECONDS:-180}"

tmp_all="$(mktemp)"
echo "Running nix-eval-jobs to detect flake outputs..." >&2
nix run github:nix-community/nix-eval-jobs --option extra-substituters "https://nix-community.cachix.org" --option extra-trusted-public-keys "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs=" -- \
  --flake . \
  --check-cache-status \
  --meta \
  --force-recurse \
  --select 'outputs: let system = "'"$system"'"; in builtins.listToAttrs (map (catName: let cat = builtins.getAttr catName outputs; in { name = catName; value = if builtins.isAttrs cat && builtins.hasAttr system cat then { ${system} = builtins.getAttr system cat; } else {}; }) (builtins.attrNames outputs))' > "$tmp_all"

# Transform nix-eval-jobs output to matrix format
echo "Processing nix-eval-jobs output..." >&2
all_outputs=$(nix -L run nixpkgs#jq -- -s -c '
  # Parse each JSON object and extract matrix fields
  map({
    attr: .attr,
    category: ((.attr | split(".") | .[0]) // "unknown"),
    system: ((.attr | split(".") | .[1]) // "unknown"), 
    name: ((.attr | split(".") | .[2]) // "default"),
    flake_attr: (".#" + .attr),
    cached: ((.cacheStatus == "cached") or (.cacheStatus == "local") or (.isCached == true)),
    store_path: (.outputs.out // (.drvPath // "unknown"))
  })
' "$tmp_all")

echo "All detected outputs: $all_outputs"

# Build include array from only uncached, buildable outputs  
include_array=$(nix -L run nixpkgs#jq -- -c '
  map(select(.cached == false))
  # Add noop flag for categories we dont want to build
  | map(
      if (.category | test("^(packages|checks)$")) then .
      else . + { noop: "true" }
      end
    )
  # Extract only fields needed for the matrix
  | map({category, system, name, flake_attr} + (if .noop then {noop: .noop} else {} end))
' <<<"$all_outputs")

echo "Computed include (uncached only): $include_array"

# Compute boolean flag indicating whether there is any work to do
has_work=$(nix -L run nixpkgs#jq -- -rc 'if (length > 0) then "true" else "false" end' <<<"$include_array")
echo "Has work: $has_work"

# Expose outputs for downstream jobs
delim="MATRIX_INCLUDE_$(date +%s)"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "matrix_include<<$delim"
    echo "$include_array"
    echo "$delim"
  } >> "$GITHUB_OUTPUT"
  echo "has_work=$has_work" >> "$GITHUB_OUTPUT"
else
  echo "GITHUB_OUTPUT not set, skipping GitHub Actions output"
fi

# Cleanup temp files
rm -f "$tmp_all"

# Write a human-readable summary to the GitHub Actions run summary
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
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
else
  echo "GITHUB_STEP_SUMMARY not set, skipping summary output"
fi



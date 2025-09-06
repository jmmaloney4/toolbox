#!/usr/bin/env bash
set -euo pipefail

ALL_OUTPUTS_JSON=${INPUT_ALL_OUTPUTS_JSON:-}
OUT_DIR=${INPUT_OUT_DIR:-images}

mkdir -p "$OUT_DIR"

# Prefer system jq, fallback to nixpkgs#jq if needed
if command -v jq >/dev/null 2>&1; then
  JQ="jq"
else
  JQ="nix run nixpkgs#jq --"
fi

if [[ -z "${ALL_OUTPUTS_JSON:-}" || "${ALL_OUTPUTS_JSON}" == "null" ]]; then
  echo "No outputs detected; skipping image artifact generation"
  echo "has_images=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Validate JSON
if ! bash -c "$JQ -e . >/dev/null" <<<"$ALL_OUTPUTS_JSON"; then
  echo "Invalid JSON provided to all-outputs-json"
  echo "has_images=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

mapfile -t image_names < <(bash -c "$JQ -r '.[] | select(.category==\"packages\" and (.name|endswith(\"-image\"))) | .name'" <<<"$ALL_OUTPUTS_JSON")
if [[ ${#image_names[@]} -eq 0 ]]; then
  echo "No image packages (-image suffix) found; nothing to generate"
  echo "has_images=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

for name in "${image_names[@]}"; do
  base="${name%-image}"
  outfile="$OUT_DIR/image-${base}.env"
  {
    echo "RUN_ATTR=#${name}.passthru.copyTo"
    echo "IMAGE_NAME=${base}"
  } > "$outfile"
  echo "Generated $outfile"
done

echo "has_images=true" >> "$GITHUB_OUTPUT"


#!/usr/bin/env bash
set -euo pipefail

# Inputs
DRY_RUN="${A_DRY_RUN,,}"
REG="${A_REGISTRY}"
ROOT="${A_ROOT}"
SCOPE="${A_SCOPE:-}"

# Outputs
SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
OUT_FILE="${GITHUB_OUTPUT:-/dev/stdout}"

# Verify jq is available
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not available" >&2
  exit 1
fi

echo "Using jq version: $(jq --version)" >&2

# Helper functions
urlencode() {
  jq -r --arg input "$1" '$input | @uri'
}

get_pkg_json_field() {
  local path="$1" field="$2"
  jq -r ".${field} // empty" "${path}/package.json"
}

compare_versions() {
  local local_ver="$1" published_ver="$2"
  if [[ "$published_ver" == "Not found" ]]; then
    echo "initial"
  else
    # Use jq for version comparison
    jq -n --arg local "$local_ver" --arg published "$published_ver" '
      def version_parts(v): (v | split("-")[0]) | split(".") | map(tonumber? // 0);
      def compare_versions(a; b):
        (a | version_parts) as $a | (b | version_parts) as $b |
        if $a[0] > $b[0] then "major"
        elif $a[0] < $b[0] then "downgrade"
        elif $a[1] > $b[1] then "minor"
        elif $a[1] < $b[1] then "downgrade"
        elif $a[2] > $b[2] then "patch"
        elif $a[2] < $b[2] then "downgrade"
        else "same" end;
      compare_versions($local; $published)
    '
  fi
}

# Start summary
echo "# 📦 pnpm packages analysis" >> "$SUMMARY_FILE"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "> **DRY RUN MODE** - No packages will be published" >> "$SUMMARY_FILE"
fi
echo "" >> "$SUMMARY_FILE"
echo "| Package | Local | Published | Change | Action |" >> "$SUMMARY_FILE"
echo "|---|---:|---:|---|---|" >> "$SUMMARY_FILE"

# Find packages
if [[ ! -d "${ROOT}/packages" ]]; then
  echo "Warning: packages directory not found at ${ROOT}/packages" >&2
  PKG_PATHS=()
else
  mapfile -t PKG_PATHS < <(find "${ROOT}/packages" -mindepth 2 -maxdepth 2 -name package.json -type f -printf '%h\n' | sort -u)
  echo "Found ${#PKG_PATHS[@]} package(s): ${PKG_PATHS[*]}" >&2
fi

# Build matrix entries
MATRIX_ENTRIES=()
for pkg_path in "${PKG_PATHS[@]}"; do
  name="$(get_pkg_json_field "$pkg_path" "name")"
  [[ -n "$SCOPE" && ! "${name}" == ${SCOPE}/* ]] && continue
  
  local_ver="$(get_pkg_json_field "$pkg_path" "version")"
  
  # Query GHCR for published version
  published_ver="Not found"
  if [[ -n "${NODE_AUTH_TOKEN:-}" ]]; then
    encoded="$(urlencode "${name}")"
    resp="$(curl -sfL \
      -H "Authorization: Bearer ${NODE_AUTH_TOKEN}" \
      -H "Accept: application/vnd.npm.install-v1+json" \
      "${REG}/${encoded}" 2>/dev/null || echo "")"
    
    if [[ -n "$resp" ]]; then
      published_ver="$(echo "$resp" | jq -r '.dist-tags.latest // "Not found"')"
    fi
  fi
  
  # Compare versions and determine action
  classify="$(compare_versions "$local_ver" "$published_ver")"
  action="publish"
  if [[ "$DRY_RUN" == "true" || "$classify" == "same" || "$classify" == "downgrade" ]]; then
    action="skip"
  fi
  
  # Add to matrix entries
  MATRIX_ENTRIES+=("$(jq -n --arg path "$pkg_path" --arg name "$name" --arg local "$local_ver" --arg published "$published_ver" --arg classify "$classify" --arg action "$action" '{
    package_path: $path,
    name: $name,
    local_version: $local,
    published_version: $published,
    release_type: $classify,
    action: $action
  }')")
  
  # Add to summary
  echo "| ${name} | ${local_ver} | ${published_ver} | ${classify} | ${action} |" >> "$SUMMARY_FILE"
done

# Build final matrix
echo "Building matrix from ${#MATRIX_ENTRIES[@]} entries" >&2
if [[ ${#MATRIX_ENTRIES[@]} -eq 0 ]]; then
  MATRIX="[]"
  echo "No packages found, using empty matrix" >&2
else
  MATRIX="$(printf '%s\n' "${MATRIX_ENTRIES[@]}" | jq -s '.')"
  echo "Generated matrix: $MATRIX" >&2
fi

# Ensure MATRIX is valid JSON
if ! echo "$MATRIX" | jq empty 2>/dev/null; then
  echo "Error: Invalid JSON matrix generated" >&2
  echo "Matrix content: $MATRIX" >&2
  MATRIX="[]"
fi

# Output matrix using GitHub Actions multiline format
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "matrix<<MATRIX_DELIMITER"
    echo "$MATRIX"
    echo "MATRIX_DELIMITER"
  } >> "$OUT_FILE"
else
  echo "matrix=${MATRIX}" >> "$OUT_FILE"
fi

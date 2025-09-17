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
  python3 -c "import urllib.parse; print(urllib.parse.quote('$1', safe=''))"
}

get_pkg_json_field() {
  local path="$1" field="$2"
  jq -r ".${field} // empty" "${path}/package.json"
}

# Initialize matrix
MATRIX="[]"

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
  mapfile -t PKG_PATHS < <(find "${ROOT}/packages" -type f -name package.json -print0 | xargs -0 -n1 dirname | sort -u)
fi

for pkg_path in "${PKG_PATHS[@]}"; do
  name="$(get_pkg_json_field "$pkg_path" "name")"
  [[ -n "$SCOPE" && "${name}" != ${SCOPE}/* ]] && continue
  
  local_ver="$(get_pkg_json_field "$pkg_path" "version")"
  
  # Query GHCR for published version
  published_ver="Not found"
  if [[ -n "${NODE_AUTH_TOKEN:-}" ]]; then
    encoded="$(urlencode "${name}")"
    set +e
    resp="$(curl -sfL \
      -H "Authorization: Bearer ${NODE_AUTH_TOKEN}" \
      -H "Accept: application/vnd.npm.install-v1+json" \
      "${REG}/${encoded}" 2>/dev/null)"
    rc=$?
    set -e
    
    if [[ $rc -eq 0 && -n "$resp" ]]; then
      published_ver="$(echo "$resp" | jq -r '.dist-tags.latest // "Not found"')"
    fi
  fi
  
  # Semver comparison
  classify="initial"
  action="publish"
  if [[ "$published_ver" != "Not found" ]]; then
    IFS='.-' read -r lmaj lmin lpat _ <<<"${local_ver}"
    IFS='.-' read -r pmaj pmin ppat _ <<<"${published_ver}"
    
    if [[ "$lmaj" == "$pmaj" && "$lmin" == "$pmin" && "$lpat" == "$ppat" ]]; then
      classify="same"
      action="skip"
    elif (( lmaj < pmaj )) || (( lmaj==pmaj && lmin < pmin )) || (( lmaj==pmaj && lmin==pmin && lpat < ppat )); then
      classify="downgrade"
      action="skip"
    else
      if (( lmaj > pmaj )); then classify="major"
      elif (( lmin > pmin )); then classify="minor"
      else classify="patch"; fi
    fi
  fi
  
  if [[ "$DRY_RUN" == "true" ]]; then
    action="skip"
  fi
  
  # Add to matrix
  entry=$(jq -n --arg path "$pkg_path" --arg name "$name" --arg local "$local_ver" --arg published "$published_ver" --arg classify "$classify" --arg action "$action" '{
    package_path: $path,
    name: $name,
    local_version: $local,
    published_version: $published,
    release_type: $classify,
    action: $action
  }')
  MATRIX=$(echo "$MATRIX" | jq --argjson entry "$entry" '. + [$entry]')
  
  # Add to summary
  echo "| ${name} | ${local_ver} | ${published_ver} | ${classify} | ${action} |" >> "$SUMMARY_FILE"
done

# Output matrix
echo "matrix=${MATRIX}" >> "$OUT_FILE"

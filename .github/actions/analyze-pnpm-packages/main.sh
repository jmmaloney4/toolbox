#!/usr/bin/env bash
set -euo pipefail

# Inputs
DRY_RUN="${A_DRY_RUN,,}"
TARGET="${A_TARGET:-release}"
REG="${A_REGISTRY:-https://npm.pkg.github.com}"
ROOT="${A_ROOT:-.}"
SCOPE="${A_SCOPE:-}"
GITHUB_REPO="${A_GITHUB_REPOSITORY:-}"

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

# Derive a short slug from a scoped package name.
# @jmmaloney4/sector7 -> sector7
# unscoped-package -> unscoped-package
pkg_slug() {
  local name="$1"
  if [[ "$name" == @* ]]; then
    echo "$name" | sed 's|^@[^/]*/||'
  else
    echo "$name"
  fi
}

# Derive the tarball filename npm pack would produce.
# @jmmaloney4/sector7 -> jmmaloney4-sector7
# plain-pkg -> plain-pkg
tarball_stem() {
  local name="$1"
  # npm pack: strip @, replace / with -
  echo "$name" | sed 's|^@||; s|/|-|g'
}

compare_versions() {
  local local_ver="$1" published_ver="$2"
  if [[ "$published_ver" == "Not found" ]]; then
    echo "initial"
  else
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

# Check if a GitHub Release asset already exists for this package+version.
# Returns "found" or "Not found".
check_release_asset() {
  local name="$1" version="$2"
  local slug
  slug="$(pkg_slug "$name")"
  local tag="${slug}-v${version}"
  local stem
  stem="$(tarball_stem "$name")"
  local asset_name="${stem}-${version}.tgz"

  if [[ -z "$GITHUB_REPO" ]]; then
    echo "Not found"
    return
  fi

  # Query GitHub Releases API for the tag
  local resp
  resp="$(curl -sfL \
    -H "Authorization: Bearer ${NODE_AUTH_TOKEN:-}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}" 2>/dev/null || echo "")"

  if [[ -z "$resp" ]]; then
    echo "Not found"
    return
  fi

  # Check if the expected asset exists in the release
  local asset_count
  asset_count="$(echo "$resp" | jq --arg name "$asset_name" '.assets | map(select(.name == $name)) | length')"

  if [[ "$asset_count" -gt 0 ]]; then
    echo "found"
  else
    echo "Not found"
  fi
}

# Check if a version is published on an npm registry (ghcr/npm/gcp).
check_registry_version() {
  local name="$1"
  local published_ver="Not found"
  if [[ -n "${NODE_AUTH_TOKEN:-}" ]]; then
    local encoded
    encoded="$(urlencode "${name}")"
    local resp
    resp="$(curl -sfL \
      -H "Authorization: Bearer ${NODE_AUTH_TOKEN:-}" \
      -H "Accept: application/vnd.npm.install-v1+json" \
      "${REG}/${encoded}" 2>/dev/null || echo "")"

    if [[ -n "$resp" ]]; then
      published_ver="$(echo "$resp" | jq -r '.dist-tags.latest // "Not found"')"
    fi
  fi
  echo "$published_ver"
}

# Start summary
echo "# 📦 pnpm packages analysis" >> "$SUMMARY_FILE"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "> **DRY RUN MODE** - No packages will be published" >> "$SUMMARY_FILE"
fi
echo "" >> "$SUMMARY_FILE"
echo "Target: **${TARGET}**" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"
echo "| Package | Local | Published | Change | Action |" >> "$SUMMARY_FILE"
echo "|---|---:|---:|---|---|" >> "$SUMMARY_FILE"

# Find packages
if [[ ! -d "${ROOT}/packages" ]]; then
  echo "Warning: packages directory not found at ${ROOT}/packages" >&2
  PKG_PATHS=()
else
  PKG_PATHS=()
  for pkg_json in "${ROOT}/packages"/*/package.json; do
    [[ -f "$pkg_json" ]] && PKG_PATHS+=("${pkg_json%/package.json}")
  done
  echo "Found ${#PKG_PATHS[@]} package(s): ${PKG_PATHS[*]}" >&2
fi

# Build matrix entries
MATRIX_ENTRIES=()
for pkg_path in "${PKG_PATHS[@]}"; do
  name="$(get_pkg_json_field "$pkg_path" "name")"
  [[ -n "$SCOPE" && ! "${name}" == ${SCOPE}/* ]] && continue

  local_ver="$(get_pkg_json_field "$pkg_path" "version")"
  slug="$(pkg_slug "$name")"
  stem="$(tarball_stem "$name")"
  release_tag="${slug}-v${local_ver}"
  asset_name="${stem}-${local_ver}.tgz"

  # Determine published status based on target
  published_ver="Not found"
  case "$TARGET" in
    release)
      asset_status="$(check_release_asset "$name" "$local_ver")"
      if [[ "$asset_status" == "found" ]]; then
        published_ver="$local_ver"
      fi
      ;;
    ghcr|npm|gcp)
      published_ver="$(check_registry_version "$name")"
      ;;
    *)
      echo "Error: unknown target '${TARGET}'" >&2
      exit 1
      ;;
  esac

  # Compare versions and determine action
  classify="$(compare_versions "$local_ver" "$published_ver")"
  action="publish"
  if [[ "$DRY_RUN" == "true" || "$classify" == "same" || "$classify" == "downgrade" ]]; then
    action="skip"
  fi

  # Add to matrix entries only if action is publish
  if [[ "$action" == "publish" ]]; then
    MATRIX_ENTRIES+=("$(jq -n \
      --arg path "$pkg_path" \
      --arg name "$name" \
      --arg local "$local_ver" \
      --arg published "$published_ver" \
      --arg classify "$classify" \
      --arg action "$action" \
      --arg target "$TARGET" \
      --arg slug "$slug" \
      --arg release_tag "$release_tag" \
      --arg asset_name "$asset_name" \
      '{
        package_path: $path,
        name: $name,
        local_version: $local,
        published_version: $published,
        release_type: $classify,
        action: $action,
        target: $target,
        slug: $slug,
        release_tag: $release_tag,
        asset_name: $asset_name
      }')")
  fi

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

# Output matrix and has_packages flag
COMPRESSED_MATRIX="$(echo "$MATRIX" | jq -c .)"
HAS_PACKAGES="false"
if [[ ${#MATRIX_ENTRIES[@]} -gt 0 ]]; then
  HAS_PACKAGES="true"
fi

echo "DEBUG: About to write outputs" >&2
echo "DEBUG: COMPRESSED_MATRIX=$COMPRESSED_MATRIX" >&2
echo "DEBUG: HAS_PACKAGES=$HAS_PACKAGES" >&2

{
  echo "matrix=$COMPRESSED_MATRIX"
  echo "has_packages=$HAS_PACKAGES"
} >> "$OUT_FILE"

echo "DEBUG: Outputs written" >&2

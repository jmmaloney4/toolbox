#!/usr/bin/env bash
set -euo pipefail

# Unified monorepo release analyzer.
# Reads version from root package.json, checks if a v${version} tag already
# exists as a GitHub Release, and outputs a matrix entry if publishing is needed.

TARGET="${A_TARGET:-release}"
DRY_RUN="${A_DRY_RUN:-false}"
GITHUB_REPO="${A_GITHUB_REPOSITORY:-}"
ROOT="${A_ROOT:-.}"

SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
OUT_FILE="${GITHUB_OUTPUT:-/dev/stdout}"

# ── Read unified version from root package.json ─────────────────────

if [[ ! -f "${ROOT}/package.json" ]]; then
  echo "Error: package.json not found at ${ROOT}" >&2
  exit 1
fi

VERSION="$(jq -r '.version // empty' "${ROOT}/package.json")"
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
  echo "Error: version field missing or empty in ${ROOT}/package.json" >&2
  exit 1
fi

TAG="v${VERSION}"

echo "# 📦 Unified release analysis" >>"$SUMMARY_FILE"
if [[ "${DRY_RUN}" == "true" ]]; then
  echo "> **DRY RUN MODE** - No packages will be published" >>"$SUMMARY_FILE"
fi
echo "" >>"$SUMMARY_FILE"
echo "- **Version:** \`${VERSION}\`" >>"$SUMMARY_FILE"
echo "- **Tag:** \`${TAG}\`" >>"$SUMMARY_FILE"
echo "- **Target:** \`${TARGET}\`" >>"$SUMMARY_FILE"

# ── Collect packages ────────────────────────────────────────────────

PKG_PATHS=()
if [[ -d "${ROOT}/packages" ]]; then
  for pkg_json in "${ROOT}/packages"/*/package.json; do
    [[ -f "$pkg_json" ]] && PKG_PATHS+=("${pkg_json%/package.json}")
  done
fi

echo "- **Packages:** ${#PKG_PATHS[@]}" >>"$SUMMARY_FILE"
echo "" >>"$SUMMARY_FILE"

if [[ ${#PKG_PATHS[@]} -eq 0 ]]; then
  echo "No packages found under ${ROOT}/packages/" >&2
  echo "matrix=[]" >>"$OUT_FILE"
  echo "has_packages=false" >>"$OUT_FILE"
  exit 0
fi

# ── Check if release already exists ─────────────────────────────────

ALREADY_PUBLISHED="false"
if [[ -n "$GITHUB_REPO" ]]; then
  if gh release view "$TAG" --repo "$GITHUB_REPO" >/dev/null 2>&1; then
    ALREADY_PUBLISHED="true"
    echo "- **Status:** already published (tag \`${TAG}\` exists)" >>"$SUMMARY_FILE"
  else
    echo "- **Status:** new release needed" >>"$SUMMARY_FILE"
  fi
else
  echo "- **Status:** unknown (no GITHUB_REPO set, assuming not published)" >>"$SUMMARY_FILE"
fi

# ── Build matrix entries ────────────────────────────────────────────

MATRIX_ENTRIES=()
for pkg_path in "${PKG_PATHS[@]}"; do
  name="$(jq -r '.name' "${pkg_path}/package.json")"
  # npm pack: strip @, replace / with -
  stem="$(echo "$name" | sed 's|^@||; s|/|-|g')"
  asset_name="${stem}-${VERSION}.tgz"

  MATRIX_ENTRIES+=("$(jq -n \
    --arg path "$pkg_path" \
    --arg name "$name" \
    --arg version "$VERSION" \
    --arg target "$TARGET" \
    --arg tag "$TAG" \
    --arg asset_name "$asset_name" \
    '{
      package_path: $path,
      name: $name,
      version: $version,
      action: "publish",
      target: $target,
      tag: $tag,
      asset_name: $asset_name
    }')")
done

# ── Decide action ───────────────────────────────────────────────────

ACTION="publish"
if [[ "$ALREADY_PUBLISHED" == "true" || "$DRY_RUN" == "true" ]]; then
  ACTION="skip"
fi

echo "" >>"$SUMMARY_FILE"
echo "| Package | Version | Action |" >>"$SUMMARY_FILE"
echo "|---|---|---|" >>"$SUMMARY_FILE"

if [[ "$ACTION" == "skip" ]]; then
  for entry in "${MATRIX_ENTRIES[@]}"; do
    name="$(echo "$entry" | jq -r '.name')"
    echo "| ${name} | ${VERSION} | ⏭️ skip |" >>"$SUMMARY_FILE"
  done
  echo "matrix=[]" >>"$OUT_FILE"
  echo "has_packages=false" >>"$OUT_FILE"
else
  for entry in "${MATRIX_ENTRIES[@]}"; do
    name="$(echo "$entry" | jq -r '.name')"
    echo "| ${name} | ${VERSION} | 🚀 publish |" >>"$SUMMARY_FILE"
  done
  MATRIX="$(printf '%s\n' "${MATRIX_ENTRIES[@]}" | jq -s '.')"
  echo "matrix=$(echo "$MATRIX" | jq -c .)" >>"$OUT_FILE"
  echo "has_packages=true" >>"$OUT_FILE"
fi

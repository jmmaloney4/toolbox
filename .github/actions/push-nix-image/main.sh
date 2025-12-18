#!/usr/bin/env bash
set -euo pipefail

# Required env vars:
# INPUT_PACKAGE_NAME
# INPUT_REGISTRY
# INPUT_NAMESPACE
# INPUT_TAGS
# INPUT_SYSTEM
# INPUT_REGISTRY_PASSWORD

# Optional env vars:
# INPUT_IMAGE_NAME
# INPUT_REGISTRY_USERNAME (default: github.actor)

REGISTRY="${INPUT_REGISTRY:-ghcr.io}"
NAMESPACE="${INPUT_NAMESPACE}"
PACKAGE="${INPUT_PACKAGE_NAME}"
SYSTEM="${INPUT_SYSTEM:-x86_64-linux}"
TAGS="${INPUT_TAGS}"
# Use GITHUB_ACTOR if username not provided
USERNAME="${INPUT_REGISTRY_USERNAME:-${GITHUB_ACTOR:-}}"
PASSWORD="${INPUT_REGISTRY_PASSWORD}"

# Determine image name
if [ -n "${INPUT_IMAGE_NAME:-}" ]; then
  IMAGE_NAME="${INPUT_IMAGE_NAME}"
else
  # Strip -image suffix if present
  IMAGE_NAME="${PACKAGE%-image}"
fi

if [ -z "$TAGS" ]; then
  echo "❌ No tags provided. Aborting." >&2
  exit 1
fi

echo "Building Nix package: ${PACKAGE}"
# Build the image once
nix build ".#packages.${SYSTEM}.${PACKAGE}" -L

IFS=',' read -ra TAG_ARRAY <<< "$TAGS"
PUSHED_COUNT=0

for tag in "${TAG_ARRAY[@]}"; do
  # Trim whitespace
  tag="$(echo "$tag" | xargs)"
  if [ -z "$tag" ]; then
    continue
  fi

  dest="docker://${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}:${tag}"
  echo "Pushing to: ${dest}"

  nix run ".#packages.${SYSTEM}.${PACKAGE}.passthru.copyTo" -- \
    "${dest}" \
    --dest-creds "${USERNAME}:${PASSWORD}"
  
  PUSHED_COUNT=$((PUSHED_COUNT + 1))
done

if [ "$PUSHED_COUNT" -eq 0 ]; then
  echo "❌ No valid tags found. No images were pushed." >&2
  exit 1
fi

echo "✅ Successfully pushed image '${IMAGE_NAME}' with ${PUSHED_COUNT} tags."

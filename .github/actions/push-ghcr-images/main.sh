#!/usr/bin/env bash
set -euo pipefail

# Script to push images to GHCR by discovering built images using nix commands
# Expects GHCR_NAMESPACE, REPOSITORY, REF as env vars (defaults to GITHUB_* equivalents)

GHCR_NAMESPACE="${GHCR_NAMESPACE:-${GITHUB_REPOSITORY}}"
REPOSITORY="${REPOSITORY:-${GITHUB_REPOSITORY}}"
REF="${REF:-${GITHUB_REF}}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
TAG_PREFIX="git-${SHA}"

# Determine additional tags based on ref
if [[ "$REF" == refs/heads/main ]]; then
  TAGS=("latest" "$TAG_PREFIX")
elif [[ "$REF" == refs/pull/*/merge ]]; then
  PR_NUMBER="${REF##refs/pull/}"
  PR_NUMBER="${PR_NUMBER%%/merge}"
  TAGS=("pr-${PR_NUMBER}" "$TAG_PREFIX")
else
  TAGS=("$TAG_PREFIX")
fi

# Discover built images using nix commands instead of artifacts
echo "Discovering built images using nix..."
shopt -s nullglob

PROCESSED_COUNT=0

# Get all packages from the flake and filter for -image packages
PACKAGES_JSON=$(nix eval --json '.#packages.${builtins.currentSystem}' 2>/dev/null) || {
  echo "Warning: Failed to query flake packages" >&2
  echo "This might indicate no packages were built or nix environment issues"
  exit 1
}

# Parse the JSON to find -image packages
echo "Found packages JSON: $PACKAGES_JSON"

# Use jq to extract package names that end with -image
IMAGE_PACKAGES=$(echo "$PACKAGES_JSON" | jq -r 'keys[] | select(endswith("-image"))' 2>/dev/null) || {
  echo "Warning: Failed to parse packages JSON or no -image packages found" >&2
  echo "This might indicate no *-image packages were built"
  exit 1
}

echo "Found image packages: $IMAGE_PACKAGES"

# Process each discovered image package
for PACKAGE_NAME in $IMAGE_PACKAGES; do
  echo "Processing image package: $PACKAGE_NAME"

  # Derive image name by removing -image suffix
  IMAGE_NAME="${PACKAGE_NAME%-image}"

  # Get the RUN_ATTR by evaluating the passthru.copyTo attribute
  RUN_ATTR=$(nix eval ".#packages.${builtins.currentSystem}.${PACKAGE_NAME}.passthru.copyTo" 2>/dev/null) || {
    echo "Error: Failed to get copyTo attribute for $PACKAGE_NAME" >&2
    continue
  }

  echo "Processing $IMAGE_NAME with $RUN_ATTR"

  IMAGE_TAG_COUNT=0
  for TAG in "${TAGS[@]}"; do
    DEST="docker://ghcr.io/${GHCR_NAMESPACE}/${IMAGE_NAME}:${TAG}"
    echo "Pushing to $DEST"

    # Validate the destination format before attempting push
    if [[ ! "$DEST" =~ ^docker://[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$ ]]; then
      echo "Error: Invalid destination format: $DEST" >&2
      continue
    fi

    if nix run ".${RUN_ATTR}" -- --dest-creds "${GITHUB_ACTOR}:${GITHUB_TOKEN}" "$DEST"; then
      ((IMAGE_TAG_COUNT++))
    else
      echo "Error: Failed to push $IMAGE_NAME:${TAG} to $DEST" >&2
      # Don't exit here - continue with other tags/images
    fi
  done

  if [[ $IMAGE_TAG_COUNT -gt 0 ]]; then
    ((PROCESSED_COUNT++))
    echo "Successfully pushed $IMAGE_TAG_COUNT tag(s) for $IMAGE_NAME"
  fi
done

# Check if any images were processed
if [[ $PROCESSED_COUNT -eq 0 ]]; then
  echo "Warning: No images were successfully processed" >&2
  echo "This might indicate that no *-image packages were built successfully or all pushes failed"
  exit 1
fi

echo "Successfully pushed $PROCESSED_COUNT image(s) to GHCR"

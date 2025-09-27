#!/usr/bin/env bash
set -euo pipefail

# Script to push a specific image to GHCR with git SHA tag
# Expects GHCR_NAMESPACE, REPOSITORY, REF, PACKAGE_NAME as env vars from action.yml

# Environment variables are now set by action.yml with proper defaults
PACKAGE_NAME="${PACKAGE_NAME}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
TAG="git-${SHA}"

# Derive image name by removing -image suffix
IMAGE_NAME="${PACKAGE_NAME%-image}"

# Get the RUN_ATTR by evaluating the passthru.copyTo attribute
RUN_ATTR=$(nix eval ".#packages.${builtins.currentSystem}.${PACKAGE_NAME}.passthru.copyTo") || {
  echo "Failed to get copyTo for $PACKAGE_NAME, skipping"
  exit 0
}

DEST="docker://ghcr.io/${GHCR_NAMESPACE}/${IMAGE_NAME}:${TAG}"
echo "Pushing $IMAGE_NAME to $DEST"

if nix run ".#${RUN_ATTR}" -- --dest-creds "${GITHUB_ACTOR}:${GITHUB_TOKEN}" "$DEST"; then
  echo "Successfully pushed $IMAGE_NAME"
else
  echo "Failed to push $IMAGE_NAME"
  exit 1
fi

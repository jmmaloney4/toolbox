#!/usr/bin/env bash
set -euo pipefail

# Script to push images to GHCR based on downloaded artifacts
# Expects GHCR_NAMESPACE, REPOSITORY, REF as env vars

GHCR_NAMESPACE="${GHCR_NAMESPACE:-${GITHUB_REPOSITORY}}"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
TAG_PREFIX="git-${SHA}"

# Determine additional tags based on ref
if [[ "$GITHUB_REF" == refs/heads/main ]]; then
  TAGS=("latest" "$TAG_PREFIX")
elif [[ "$GITHUB_REF" == refs/pull/*/merge ]]; then
  PR_NUMBER="${GITHUB_REF##refs/pull/}"
  PR_NUMBER="${PR_NUMBER%%/merge}"
  TAGS=("pr-${PR_NUMBER}" "$TAG_PREFIX")
else
  TAGS=("$TAG_PREFIX")
fi

# Download all image artifacts
echo "Downloading image artifacts..."
shopt -s nullglob
for artifact in image-*.env; do
  if [[ -f "$artifact" ]]; then
    source "$artifact"
    echo "Processing $IMAGE_NAME with $RUN_ATTR"

    for TAG in "${TAGS[@]}"; do
      DEST="docker://ghcr.io/${GHCR_NAMESPACE}/${IMAGE_NAME}:${TAG}"
      echo "Pushing to $DEST"
      nix run ".${RUN_ATTR}" -- --dest-creds "${GITHUB_ACTOR}:${GITHUB_TOKEN}" "$DEST"
    done
  fi
done

echo "All images pushed successfully"

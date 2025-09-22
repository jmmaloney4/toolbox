#!/usr/bin/env bash
set -euo pipefail

# Script to push images to GHCR based on downloaded artifacts
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

# Download all image artifacts
echo "Downloading image artifacts..."
shopt -s nullglob

PROCESSED_COUNT=0
for artifact in image-*.env; do
  if [[ -f "$artifact" ]]; then
    # Safely parse the artifact file instead of sourcing it to prevent shell injection
    unset RUN_ATTR IMAGE_NAME
    while IFS='=' read -r key value; do
      case "$key" in
        RUN_ATTR) RUN_ATTR="$value" ;;
        IMAGE_NAME) IMAGE_NAME="$value" ;;
      esac
    done < "$artifact"

    # Validate that we have the required variables
    if [[ -z "$RUN_ATTR" || -z "$IMAGE_NAME" ]]; then
      echo "Error: Invalid artifact file format in $artifact" >&2
      continue
    fi

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
  fi
done

# Check if any artifacts were processed
if [[ $PROCESSED_COUNT -eq 0 ]]; then
  echo "Warning: No image artifacts were successfully processed" >&2
  echo "This might indicate that no *-image packages were built successfully or all pushes failed"
  exit 1
fi

echo "Successfully pushed $PROCESSED_COUNT image(s) to GHCR"

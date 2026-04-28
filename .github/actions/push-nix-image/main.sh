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

# Determine authentication method
if [ "${INPUT_USE_GCP_AUTH:-false}" = "true" ]; then
  echo "🔐 Using GCP OIDC authentication"
  
  # Verify gcloud is available
  if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI not found but GCP auth requested" >&2
    echo "   Ensure the gcp-auth action ran before this step" >&2
    exit 1
  fi
  
  # Get access token from gcloud
  USERNAME="oauth2accesstoken"
  if ! PASSWORD="$(gcloud auth print-access-token 2>&1)"; then
    echo "❌ Error: Failed to get GCP access token" >&2
    echo "   Output: $PASSWORD" >&2
    exit 1
  fi
  
  echo "✅ Successfully obtained GCP access token"
else
  echo "🔐 Using username/password authentication"
  USERNAME="${INPUT_REGISTRY_USERNAME:-${GITHUB_ACTOR:-}}"
  PASSWORD="${INPUT_REGISTRY_PASSWORD}"
  
  if [ -z "$PASSWORD" ]; then
    echo "❌ Error: No registry password provided" >&2
    exit 1
  fi
fi

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

#!/usr/bin/env bash
# Generic nix2container image build+push script
# Env vars: NIX_ATTR, IMAGE_NAME, IMAGE_TAG, ARTIFACT_REGISTRY_URL, 
#           REPO_ROOT, RESULT_LINK (default: result-image), COMMAND_LOG_STEM,
#           AUTH_MODE (default: "gcloud"): "gcloud" or "ghcr"

set -euo pipefail

# Validate required env vars
for var in NIX_ATTR IMAGE_NAME IMAGE_TAG ARTIFACT_REGISTRY_URL REPO_ROOT; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: Required env var $var is not set" >&2
    exit 1
  fi
done

RESULT_LINK="${RESULT_LINK:-result-image}"
COMMAND_LOG_STEM="${COMMAND_LOG_STEM:-.pulumi/command-logs}"
AUTH_MODE="${AUTH_MODE:-gcloud}"

# Set up logging
LOG_DIR="${COMMAND_LOG_STEM}"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/$(date +%Y%m%d-%H%M%S)-${IMAGE_NAME}.log"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "=== Building ${IMAGE_NAME}:${IMAGE_TAG} ==="
echo "NIX_ATTR: ${NIX_ATTR}"
echo "REPO_ROOT: ${REPO_ROOT}"
echo "AUTH_MODE: ${AUTH_MODE}"

# Create temp files early so they can be cleaned up by the trap
DIGEST_FILE=$(mktemp)
AUTH_FILE=$(mktemp)
trap 'rm -f "${AUTH_FILE}" "${RESULT_LINK}" "${DIGEST_FILE}"' EXIT

# Build the image
echo "--- nix build ---"
nix build "${REPO_ROOT}#${NIX_ATTR}" -o "${RESULT_LINK}" -L

IMAGE_PATH="nix:./${RESULT_LINK}"
FULL_TAG="${ARTIFACT_REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"

# Authenticate
echo "--- authenticating (${AUTH_MODE}) ---"
case "${AUTH_MODE}" in
  gcloud)
    gcloud auth print-access-token       | nix run github:nlewo/nix2container#skopeo-nix2container --           login -u oauth2accesstoken --password-stdin           --authfile "${AUTH_FILE}"           "${ARTIFACT_REGISTRY_URL}"
    ;;
  ghcr)
    if [ -z "${GITHUB_TOKEN:-}" ] || [ -z "${GITHUB_USER:-}" ]; then
      echo "ERROR: GITHUB_TOKEN and GITHUB_USER env vars required for ghcr auth mode" >&2
      exit 1
    fi
    nix run github:nlewo/nix2container#skopeo-nix2container --       login -u "${GITHUB_USER}" --password-stdin       --authfile "${AUTH_FILE}"       "${ARTIFACT_REGISTRY_URL}" <<< "${GITHUB_TOKEN}"
    ;;
  *)
    echo "ERROR: Unknown AUTH_MODE '${AUTH_MODE}' (expected 'gcloud' or 'ghcr')" >&2
    exit 1
    ;;
esac

# Push the image
echo "--- skopeo copy ---"
nix run github:nlewo/nix2container#skopeo-nix2container --   copy --digestfile "${DIGEST_FILE}"   --authfile "${AUTH_FILE}"   "${IMAGE_PATH}"   "docker://${FULL_TAG}"

DIGEST=$(cat "${DIGEST_FILE}")

echo "=== Pushed ${FULL_TAG} ==="
echo "=== Digest: ${DIGEST} ==="
echo "DIGEST_OUTPUT:${DIGEST}"

#!/usr/bin/env bash
set -euo pipefail

# Script to detect successful *-image builds and create .env artifacts
# Expects PACKAGE_NAME and IMAGE_NAME as env vars from action.yml

# Validate inputs to prevent path traversal and command injection
if ! [[ "$IMAGE_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Error: Invalid characters in image-name. Only alphanumeric, dots, underscores, and hyphens are allowed." >&2
  exit 1
fi

if ! [[ "$PACKAGE_NAME" =~ ^[a-zA-Z0-9._-]+-image$ ]]; then
  echo "Error: Invalid characters in package-name. Only alphanumeric, dots, underscores, hyphens, and '-image' suffix are allowed." >&2
  exit 1
fi

if [[ "$PACKAGE_NAME" == *-image ]]; then
  BASE_NAME="${IMAGE_NAME}"
  RUN_ATTR="#${PACKAGE_NAME}.passthru.copyTo"

  # Use printf for safer writing and atomicity
  printf "RUN_ATTR=%s\nIMAGE_NAME=%s\n" "${RUN_ATTR}" "${BASE_NAME}" > "image-${BASE_NAME}.env"

  echo "Created artifact for image: ${BASE_NAME}"
else
  echo "Package ${PACKAGE_NAME} is not an image package, skipping artifact creation"
fi

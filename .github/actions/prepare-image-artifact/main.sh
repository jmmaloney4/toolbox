#!/usr/bin/env bash
set -euo pipefail

# Script to detect successful *-image builds and create .env artifacts
# Expects PACKAGE_NAME and IMAGE_NAME as env vars from action.yml

if [[ "$PACKAGE_NAME" == *-image ]]; then
  BASE_NAME="${IMAGE_NAME}"
  RUN_ATTR="#${PACKAGE_NAME}.passthru.copyTo"

  echo "RUN_ATTR=${RUN_ATTR}" > "image-${BASE_NAME}.env"
  echo "IMAGE_NAME=${BASE_NAME}" >> "image-${BASE_NAME}.env"

  echo "Created artifact for image: ${BASE_NAME}"
else
  echo "Package ${PACKAGE_NAME} is not an image package, skipping artifact creation"
fi

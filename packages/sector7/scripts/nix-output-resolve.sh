#!/usr/bin/env bash
# Resolve or build a nix flake attribute and output its store path.
#
# Modes (controlled by SCRIPT_MODE env var):
#   "resolve" - evaluate the flake to find the store path without building (default)
#   "build"   - build the derivation, then output the store path
#
# Env vars:
#   NIX_ATTR          - flake attribute path (e.g. "packages.x86_64-linux.lens-api-image")
#   REPO_ROOT         - absolute path to repo root containing the flake
#   SUB_OUTPUT        - named output from a multi-output derivation (e.g. "docs", "dev")
#   SUB_PATH          - sub-path within the resolved store path (e.g. "assets/style.css")
#   SCRIPT_MODE       - "resolve" (default) or "build"
#   COMMAND_LOG_STEM  - log directory path (default: .pulumi/command-logs)

set -euo pipefail

SCRIPT_MODE="${SCRIPT_MODE:-resolve}"
COMMAND_LOG_STEM="${COMMAND_LOG_STEM:-.pulumi/command-logs}"

# Validate required env vars
for var in NIX_ATTR REPO_ROOT; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: Required env var $var is not set" >&2
    exit 1
  fi
done

# Build the full attribute path with optional sub-output
FULL_ATTR="${NIX_ATTR}"
if [ -n "${SUB_OUTPUT:-}" ]; then
  FULL_ATTR="${NIX_ATTR}^${SUB_OUTPUT}"
fi

# Set up logging
LOG_DIR="${COMMAND_LOG_STEM}"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/$(date +%Y%m%d-%H%M%S)-nix-output-${SCRIPT_MODE}.log"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "=== nix-output ${SCRIPT_MODE} ${FULL_ATTR} ==="
echo "REPO_ROOT: ${REPO_ROOT}"

STORE_PATH=""

if [ "${SCRIPT_MODE}" = "build" ]; then
  # Build the derivation
  echo "--- nix build ---"
  STORE_PATH=$(nix build "${REPO_ROOT}#${FULL_ATTR}" --no-link --print-out-paths -L)
else
  # Resolve without building
  echo "--- nix eval ---"
  # nix eval --raw gives the store path for a derivation output
  STORE_PATH=$(nix eval --raw "${REPO_ROOT}#${FULL_ATTR}")
fi

if [ -z "${STORE_PATH}" ]; then
  echo "ERROR: Could not resolve store path for ${FULL_ATTR}" >&2
  exit 1
fi

# Apply sub-path if specified
if [ -n "${SUB_PATH:-}" ]; then
  FULL_PATH="${STORE_PATH}/${SUB_PATH}"
  if [ ! -e "${FULL_PATH}" ]; then
    echo "ERROR: Sub-path '${SUB_PATH}' does not exist within ${STORE_PATH}" >&2
    exit 1
  fi
  # Resolve to absolute path (handles symlinks, .., etc.)
  STORE_PATH=$(cd "$(dirname "${FULL_PATH}")" && pwd)/$(basename "${FULL_PATH}")
fi

echo "=== Resolved: ${STORE_PATH} ==="
echo "STORE_PATH_OUTPUT:${STORE_PATH}"

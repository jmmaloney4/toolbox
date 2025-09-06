#!/usr/bin/env bash
set -euo pipefail

images_dir=${INPUT_IMAGES_DIR:-images}
IMAGE_REPO_PREFIX=${INPUT_IMAGE_REPO_PREFIX}
TOKEN=${INPUT_GITHUB_TOKEN}
ACTOR_IN=${INPUT_ACTOR:-}
actor="${ACTOR_IN:-${GITHUB_ACTOR:-}}"
if [[ -z "$actor" ]]; then
  echo "::error::Actor not provided and GITHUB_ACTOR is empty"
  exit 1
fi

# Prefer system jq, fallback to nixpkgs#jq if needed
if command -v jq >/dev/null 2>&1; then
  JQ="jq"
else
  JQ="nix run nixpkgs#jq --"
fi

shopt -s nullglob
files=("${images_dir}"/*.env)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No image artifacts found in ${images_dir}; nothing to push."
  exit 0
fi

rc=0
for f in "${files[@]}"; do
  # shellcheck disable=SC1090
  source "$f"
  repo_base="${IMAGE_REPO_PREFIX}/${IMAGE_NAME}"
  dest_primary="docker://${repo_base}:git-${GITHUB_SHA}"
  addl_args=()

  if [[ "${GITHUB_EVENT_NAME}" == "push" && "${GITHUB_REF}" == "refs/heads/main" ]]; then
    addl_args+=(--additional-tag "${repo_base}:latest")
  fi

  # Pull request tag if number available
  pr_number=""
  if [[ -n "${GITHUB_EVENT_PATH:-}" && -f "${GITHUB_EVENT_PATH}" ]]; then
    pr_number=$(bash -c "$JQ -r '(.number // .pull_request.number // \"\") | tostring'" <"${GITHUB_EVENT_PATH}" || echo "")
  fi
  if [[ -n "${pr_number}" && "${pr_number}" != "null" && "${GITHUB_EVENT_NAME}" == "pull_request" ]]; then
    addl_args+=(--additional-tag "${repo_base}:pr-${pr_number}")
  fi

  echo "Pushing ${dest_primary} using nix run .${RUN_ATTR} with additional tags: ${addl_args[*]:-<none>}"
  if ! nix -L run ".${RUN_ATTR}" -- "${dest_primary}" "${addl_args[@]}" --dest-creds "${actor}:${TOKEN}"; then
    echo "Failed to push ${dest_primary} (${addl_args[*]:-no additional tags})"
    rc=1
  fi
done
exit $rc


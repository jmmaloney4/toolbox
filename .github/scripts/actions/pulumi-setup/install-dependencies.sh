#!/bin/bash
# Install dependencies for Pulumi projects using Nix
# Arguments:
#   $1 - Working directory

set -euo pipefail

WORKING_DIR="${1:-.}"
cd "$WORKING_DIR"

echo "Installing dependencies in: $WORKING_DIR"

# Use Nix development shell for dependency installation
if [ -f "package.json" ]; then
  echo "Installing npm/pnpm dependencies via Nix..."
  if command -v pnpm >/dev/null 2>&1 || nix develop -c sh -c 'command -v pnpm' >/dev/null 2>&1; then
    nix develop -c pnpm install
  else
    nix develop -c npm install
  fi
elif [ -f "requirements.txt" ]; then
  echo "Installing Python dependencies via Nix..."
  nix develop -c pip install -r requirements.txt
elif [ -f "Pipfile" ]; then
  echo "Installing Python dependencies via pipenv..."
  nix develop -c pipenv install
elif [ -f "poetry.lock" ]; then
  echo "Installing Python dependencies via poetry..."
  nix develop -c poetry install
else
  echo "No recognized dependency files found"
fi

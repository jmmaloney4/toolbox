#!/usr/bin/env bash
set -euo pipefail

attr=${INPUT_FLAKE_ATTR}
echo "Building via nix-fast-build: ${attr}"

# Use nix shell to run nix-fast-build (matches reference pattern)
nix shell nixpkgs#nix-fast-build -c nix-fast-build --skip-cached --no-nom --no-link --flake "${attr}"


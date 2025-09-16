#!/usr/bin/env bash
set -euo pipefail

echo "🔍 Detecting Pulumi stacks..." >&2

# Output JSON array of {project, stack} for all stacks
first=1
echo -n "["
# Find all directories that contain Pulumi.yaml files recursively
while IFS= read -r -d '' proj; do
  proj=$(dirname "$proj")
  # Remove ./ prefix if present for cleaner output
  proj_clean=${proj#./}
  for stackfile in "$proj"/Pulumi.*.yaml; do
    [ -e "$stackfile" ] || continue
    # Use shell parameter expansion to robustly extract stack name
    # from filename, e.g., Pulumi.prod.yaml -> prod
    filename=$(basename "$stackfile")
    temp=${filename#Pulumi.}
    stackname=${temp%.yaml}
    if [ $first -eq 0 ]; then echo -n ", "; fi
    echo -n "{\"project\":\"$proj_clean\",\"stack\":\"$stackname\"}"
    first=0
  done
done < <(find . -name "Pulumi.yaml" -type f -print0)
echo "]"

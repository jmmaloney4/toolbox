#!/usr/bin/env bash
set -euo pipefail

search_path="${INPUT_PATH:?INPUT_PATH is required}"
output_file="comment.md"

echo "## ☁️ Pulumi Preview Results" > "$output_file"
echo "" >> "$output_file"
echo "_Updated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')_" >> "$output_file"
echo "" >> "$output_file"

found_any=false

shopt -s nullglob
for file in "$search_path"/*.txt; do
  if [[ -f "$file" ]]; then
    filename=$(basename "$file" .txt)
    content=$(sed -e 's/\x1b\[[0-9;]*m//g' "$file")

    echo "<details><summary><strong>$filename</strong></summary>" >> "$output_file"
    echo "" >> "$output_file"
    echo '```diff' >> "$output_file"
    echo "$content" >> "$output_file"
    echo '```' >> "$output_file"
    echo "" >> "$output_file"
    echo "</details>" >> "$output_file"

    found_any=true
  fi
done

if [ "$found_any" = false ]; then
  echo "No preview artifacts found or no changes detected." >> "$output_file"
fi

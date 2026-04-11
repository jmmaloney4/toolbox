#!/usr/bin/env bash
set -euo pipefail

# --- Inputs (set via env in action.yml) ---
PROJECT_URL="${INPUT_PROJECT_URL}"
export GH_TOKEN="${INPUT_GITHUB_TOKEN}"
LABELED="${INPUT_LABELED:-}"
LABEL_OPERATOR="${INPUT_LABEL_OPERATOR:-OR}"

# --- Parse project URL ---
# Accepts: https://github.com/orgs/{owner}/projects/{number}
#          https://github.com/users/{owner}/projects/{number}
if [[ ! "$PROJECT_URL" =~ ^https://github\.com/(orgs|users)/([^/]+)/projects/([0-9]+)/?$ ]]; then
  echo "::error::Invalid project URL: ${PROJECT_URL}"
  echo "::error::Expected: https://github.com/{orgs|users}/{owner}/projects/{number}"
  exit 1
fi
OWNER_TYPE="${BASH_REMATCH[1]}"
OWNER_NAME="${BASH_REMATCH[2]}"
PROJECT_NUMBER="${BASH_REMATCH[3]}"

GRAPHQL_OWNER="organization"
[[ "$OWNER_TYPE" == "users" ]] && GRAPHQL_OWNER="user"

echo "::group::Add to project ${OWNER_TYPE}/${OWNER_NAME}/${PROJECT_NUMBER}"

# --- Read issue/PR from event payload ---
EVENT=$(cat "$GITHUB_EVENT_PATH")
CONTENT_ID=$(jq -r '(.issue // .pull_request).node_id // empty' <<< "$EVENT")
ISSUE_OWNER=$(jq -r '.repository.owner.login // empty' <<< "$EVENT")

if [[ -z "$CONTENT_ID" ]]; then
  echo "::error::Could not determine issue/PR node_id from event payload"
  exit 1
fi

# --- Label filtering ---
if [[ -n "$LABELED" ]]; then
  ISSUE_LABELS=$(jq -r '(.issue // .pull_request | .labels // []) | map(.name | ascii_downcase) | join(",")' <<< "$EVENT")
  # Normalize filter labels to lowercase
  FILTER_LABELS="${LABELED,,}"

  PASS=false
  OP="${LABEL_OPERATOR,,}"

  case "$OP" in
    and)
      PASS=true
      IFS=',' read -ra LABELS_ARR <<< "$FILTER_LABELS"
      for label in "${LABELS_ARR[@]}"; do
        label=$(echo "$label" | xargs)
        [[ -z "$label" ]] && continue
        if [[ ",${ISSUE_LABELS}," != *",${label},"* ]]; then
          echo "::notice::Skipping: label '${label}' not found (AND filter)"
          PASS=false
          break
        fi
      done
      ;;
    not)
      PASS=true
      IFS=',' read -ra LABELS_ARR <<< "$FILTER_LABELS"
      for label in "${LABELS_ARR[@]}"; do
        label=$(echo "$label" | xargs)
        [[ -z "$label" ]] && continue
        if [[ ",${ISSUE_LABELS}," == *",${label},"* ]]; then
          echo "::notice::Skipping: label '${label}' found (NOT filter)"
          PASS=false
          break
        fi
      done
      ;;
    *)
      # OR (default) — at least one filter label must be present
      PASS=false
      IFS=',' read -ra LABELS_ARR <<< "$FILTER_LABELS"
      for label in "${LABELS_ARR[@]}"; do
        label=$(echo "$label" | xargs)
        [[ -z "$label" ]] && continue
        if [[ ",${ISSUE_LABELS}," == *",${label},"* ]]; then
          PASS=true
          break
        fi
      done
      if [[ "$PASS" == "false" ]]; then
        echo "::notice::Skipping: no matching labels (OR filter: ${LABELED})"
      fi
      ;;
  esac

  if [[ "$PASS" == "false" ]]; then
    echo "::endgroup::"
    exit 0
  fi
fi

# --- Get project node ID ---
echo "Fetching project node ID..."
PROJECT_ID=$(gh api graphql \
  -f query="query(\$owner: String!, \$number: Int!) {
    ${GRAPHQL_OWNER}(login: \$owner) { projectV2(number: \$number) { id } }
  }" \
  -f owner="$OWNER_NAME" \
  -F number="$PROJECT_NUMBER" \
  --jq ".${GRAPHQL_OWNER}.projectV2.id")

if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "null" ]]; then
  echo "::error::Project not found at ${PROJECT_URL}"
  exit 1
fi

# --- Add item to project ---
if [[ "$ISSUE_OWNER" == "$OWNER_NAME" ]]; then
  echo "Adding item to project (same owner)"
  ITEM_ID=$(gh api graphql \
    -f query='mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }' \
    -f projectId="$PROJECT_ID" \
    -f contentId="$CONTENT_ID" \
    --jq '.addProjectV2ItemById.item.id')
else
  # Cross-owner: create a draft issue linking to the original
  ISSUE_URL=$(jq -r '(.issue // .pull_request).html_url // empty' <<< "$EVENT")
  echo "Adding draft issue to project (cross-owner: ${ISSUE_OWNER} -> ${OWNER_NAME})"
  ITEM_ID=$(gh api graphql \
    -f query='mutation($projectId: ID!, $title: String!) {
      addProjectV2DraftIssue(input: { projectId: $projectId, title: $title }) {
        projectItem { id }
      }
    }' \
    -f projectId="$PROJECT_ID" \
    -f title="$ISSUE_URL" \
    --jq '.addProjectV2DraftIssue.projectItem.id')
fi

if [[ -z "$ITEM_ID" || "$ITEM_ID" == "null" ]]; then
  echo "::error::Failed to add item to project at ${PROJECT_URL}"
  exit 1
fi

echo "itemId=${ITEM_ID}" >> "$GITHUB_OUTPUT"
echo "Added item ${ITEM_ID}"
echo "::endgroup::"

#!/usr/bin/env bash
# =============================================================================
# submit-plugin.sh — Submit the Obsidian plugin for community review
#
# Follows the official workflow described at:
#   https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
#
# This script:
#   1. Validates prerequisites (README, LICENSE, manifest.json, GitHub release)
#   2. Checks that your plugin ID is not already taken
#   3. Generates the JSON entry for community-plugins.json
#   4. Copies the entry to your clipboard
#   5. Opens the GitHub edit page in your browser so you can paste and submit
#
# Usage:
#   ./scripts/submit-plugin.sh
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated: https://cli.github.com
#   - Your plugin must already have at least one published GitHub Release
#   - manifest.json, README.md, and LICENSE must exist
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RELEASES_REPO="obsidianmd/obsidian-releases"
EDIT_URL="https://github.com/$RELEASES_REPO/edit/master/community-plugins.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ ${NC}$*"; }
ok()    { echo -e "${GREEN}✔ ${NC}$*"; }
warn()  { echo -e "${YELLOW}⚠ ${NC}$*"; }
error() { echo -e "${RED}✖ ${NC}$*" >&2; }
die()   { error "$@"; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
check_prerequisites() {
  command -v git  >/dev/null 2>&1 || die "git is required but not installed."
  command -v gh   >/dev/null 2>&1 || die "GitHub CLI (gh) is required. Install: https://cli.github.com"
  command -v node >/dev/null 2>&1 || die "Node.js is required but not installed."

  gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated. Run: gh auth login"

  [[ -f "$PROJECT_DIR/manifest.json" ]] || die "manifest.json not found."

  if [[ ! -f "$PROJECT_DIR/README.md" ]] && [[ ! -f "$PROJECT_DIR/Readme.md" ]]; then
    die "README.md not found. It is required for plugin submission."
  fi

  [[ -f "$PROJECT_DIR/LICENSE" ]] || die "LICENSE file not found. It is required for plugin submission."
}

# ---------------------------------------------------------------------------
# Read plugin metadata from manifest.json
# ---------------------------------------------------------------------------
read_manifest() {
  PLUGIN_ID=$(node -e "console.log(require('$PROJECT_DIR/manifest.json').id)")
  PLUGIN_NAME=$(node -e "console.log(require('$PROJECT_DIR/manifest.json').name)")
  PLUGIN_AUTHOR=$(node -e "console.log(require('$PROJECT_DIR/manifest.json').author)")
  PLUGIN_DESC=$(node -e "console.log(require('$PROJECT_DIR/manifest.json').description)")
  PLUGIN_VERSION=$(node -e "console.log(require('$PROJECT_DIR/manifest.json').version)")
}

# ---------------------------------------------------------------------------
# Determine the GitHub repo path (owner/repo)
# ---------------------------------------------------------------------------
get_repo_path() {
  local remote_url
  remote_url=$(git -C "$PROJECT_DIR" remote get-url origin 2>/dev/null) \
    || die "No git remote 'origin' found. Push your repo to GitHub first."

  REPO_PATH=$(echo "$remote_url" \
    | sed -E 's#^https?://github\.com/##' \
    | sed -E 's#^git@github\.com:##' \
    | sed -E 's#\.git$##')

  [[ "$REPO_PATH" =~ ^[^/]+/[^/]+$ ]] \
    || die "Could not parse GitHub repo path from: $remote_url"
}

# ---------------------------------------------------------------------------
# Validate: plugin ID must not contain "obsidian"
# ---------------------------------------------------------------------------
check_plugin_id() {
  if echo "$PLUGIN_ID" | grep -qi "obsidian"; then
    die "Plugin ID '$PLUGIN_ID' contains 'obsidian', which is not allowed by Obsidian's submission rules."
  fi
}

# ---------------------------------------------------------------------------
# Check if a GitHub release exists
# ---------------------------------------------------------------------------
check_release_exists() {
  info "Checking for existing GitHub releases..."
  local release_count
  release_count=$(gh release list --repo "$REPO_PATH" --limit 1 2>/dev/null | wc -l | tr -d ' ')

  if [[ "$release_count" -eq 0 ]]; then
    die "No GitHub releases found for $REPO_PATH.
    You must create a release first. Run: ./scripts/release.sh"
  fi

  # Verify the latest release has main.js and manifest.json attached
  local latest_tag
  latest_tag=$(gh release list --repo "$REPO_PATH" --limit 1 --json tagName --jq '.[0].tagName' 2>/dev/null)
  local assets
  assets=$(gh release view "$latest_tag" --repo "$REPO_PATH" --json assets --jq '.assets[].name' 2>/dev/null || echo "")

  if ! echo "$assets" | grep -q "main.js"; then
    warn "Latest release ($latest_tag) is missing main.js attachment."
  fi
  if ! echo "$assets" | grep -q "manifest.json"; then
    warn "Latest release ($latest_tag) is missing manifest.json attachment."
  fi

  ok "Found release: $latest_tag"
}

# ---------------------------------------------------------------------------
# Check if plugin ID already exists in community-plugins.json
# ---------------------------------------------------------------------------
check_plugin_not_submitted() {
  info "Checking if plugin ID '$PLUGIN_ID' is already registered..."

  local content
  content=$(gh api "repos/$RELEASES_REPO/contents/community-plugins.json" \
    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo "")

  if [[ -z "$content" ]]; then
    warn "Could not fetch community-plugins.json to verify. Proceeding anyway."
    return
  fi

  if echo "$content" | node -e "
    const data = require('fs').readFileSync('/dev/stdin', 'utf8');
    try {
      const plugins = JSON.parse(data);
      const found = plugins.some(p => p.id === '$PLUGIN_ID');
      process.exit(found ? 1 : 0);
    } catch { process.exit(0); }
  " 2>/dev/null; then
    ok "Plugin ID '$PLUGIN_ID' is available"
  else
    die "Plugin ID '$PLUGIN_ID' already exists in community-plugins.json.
    Your plugin may have already been submitted."
  fi
}

# ---------------------------------------------------------------------------
# Generate JSON entry and copy to clipboard
# ---------------------------------------------------------------------------
generate_entry_and_copy() {
  # Build the JSON snippet to be appended (with leading comma for pasting)
  local entry
  entry=$(node -e "
    const entry = {
      id: '$PLUGIN_ID',
      name: '$PLUGIN_NAME',
      author: '$PLUGIN_AUTHOR',
      description: $(node -e "console.log(JSON.stringify('$PLUGIN_DESC'))"),
      repo: '$REPO_PATH'
    };
    console.log(JSON.stringify(entry, null, '\t'));
  ")

  echo ""
  echo -e "  ${BOLD}JSON entry to add at the end of community-plugins.json:${NC}"
  echo ""
  echo -e "${GREEN}$entry${NC}"
  echo ""

  # Copy to clipboard (macOS)
  if command -v pbcopy >/dev/null 2>&1; then
    echo "$entry" | pbcopy
    ok "Copied to clipboard (pbcopy)"
  elif command -v xclip >/dev/null 2>&1; then
    echo "$entry" | xclip -selection clipboard
    ok "Copied to clipboard (xclip)"
  elif command -v xsel >/dev/null 2>&1; then
    echo "$entry" | xsel --clipboard
    ok "Copied to clipboard (xsel)"
  else
    warn "Could not copy to clipboard. Please copy the JSON above manually."
  fi
}

# ---------------------------------------------------------------------------
# Open the edit page in the browser
# ---------------------------------------------------------------------------
open_edit_page() {
  info "Opening GitHub edit page in your browser..."
  echo ""
  echo -e "  ${CYAN}$EDIT_URL${NC}"
  echo ""

  if command -v open >/dev/null 2>&1; then
    open "$EDIT_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$EDIT_URL"
  else
    warn "Could not open browser automatically. Please open the URL above manually."
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   Obsidian Plugin Submission Helper          ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  check_prerequisites
  read_manifest
  get_repo_path
  check_plugin_id

  echo ""
  echo -e "  ${BOLD}Plugin Details:${NC}"
  echo -e "    ID:          ${GREEN}$PLUGIN_ID${NC}"
  echo -e "    Name:        $PLUGIN_NAME"
  echo -e "    Author:      $PLUGIN_AUTHOR"
  echo -e "    Version:     $PLUGIN_VERSION"
  echo -e "    Repo:        $REPO_PATH"
  echo -e "    Description: $PLUGIN_DESC"
  echo ""

  check_release_exists
  check_plugin_not_submitted

  generate_entry_and_copy
  open_edit_page

  echo ""
  echo -e "${BOLD}Next steps in the browser:${NC}"
  echo ""
  echo "  1. Scroll to the end of the JSON array (before the closing \`]\`)"
  echo "  2. Add a comma after the last entry's \`}\`"
  echo "  3. Paste the JSON entry from your clipboard"
  echo "  4. Click ${BOLD}Commit changes...${NC} → ${BOLD}Propose changes${NC}"
  echo "  5. Click ${BOLD}Create pull request${NC}"
  echo "  6. Select ${BOLD}Preview${NC}, then select ${BOLD}Community Plugin${NC}"
  echo "  7. Click ${BOLD}Create pull request${NC}"
  echo "  8. Set PR title to: ${CYAN}Add plugin: $PLUGIN_NAME${NC}"
  echo "  9. Fill in the checklist, then submit"
  echo ""
  echo -e "${GREEN}Done! Wait for the bot validation and team review.${NC}"
  echo ""
}

main "$@"

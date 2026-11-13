#!/usr/bin/env bash
# =============================================================================
# release.sh — Create a GitHub Release for the Obsidian plugin
#
# Usage:
#   ./scripts/release.sh [version]
#   ./scripts/release.sh --current    # Release current version (no bump, no commit)
#
# Examples:
#   ./scripts/release.sh 1.6.0    # Release version 1.6.0
#   ./scripts/release.sh patch    # Bump patch version (1.5.0 → 1.5.1)
#   ./scripts/release.sh minor    # Bump minor version (1.5.0 → 1.6.0)
#   ./scripts/release.sh major    # Bump major version (1.5.0 → 2.0.0)
#   ./scripts/release.sh --current # Build + tag + release current manifest version
#   ./scripts/release.sh          # Interactive prompt
#
# Prerequisites:
#   - Node.js & npm installed
#   - GitHub CLI (gh) installed and authenticated: https://cli.github.com
#   - Git remote "origin" points to your GitHub repository
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}ℹ ${NC}$*"; }
ok()    { echo -e "${GREEN}✔ ${NC}$*"; }
warn()  { echo -e "${YELLOW}⚠ ${NC}$*"; }
error() { echo -e "${RED}✖ ${NC}$*" >&2; }
die()   { error "$@"; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
check_prerequisites() {
  command -v node >/dev/null 2>&1 || die "Node.js is required but not installed."
  command -v npm  >/dev/null 2>&1 || die "npm is required but not installed."
  command -v git  >/dev/null 2>&1 || die "git is required but not installed."
  command -v gh   >/dev/null 2>&1 || die "GitHub CLI (gh) is required. Install: https://cli.github.com"

  # Ensure gh is authenticated
  gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated. Run: gh auth login"

  # Ensure we are in a git repo with a remote
  git -C "$PROJECT_DIR" remote get-url origin >/dev/null 2>&1 \
    || die "No git remote 'origin' found. Push your repo to GitHub first."
}

# ---------------------------------------------------------------------------
# Version helpers
# ---------------------------------------------------------------------------
get_current_version() {
  node -e "console.log(require('$PROJECT_DIR/manifest.json').version)"
}

bump_version() {
  local current="$1" part="$2"
  IFS='.' read -r major minor patch <<< "$current"
  case "$part" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    *)     die "Invalid bump type: $part (use major, minor, or patch)" ;;
  esac
}

validate_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Invalid semver: $1 (expected x.y.z)"
}

# ---------------------------------------------------------------------------
# Update version in manifest.json, package.json, and versions.json
# ---------------------------------------------------------------------------
update_versions() {
  (cd "$PROJECT_DIR" && node scripts/version-bump.mjs "$1")
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
build_plugin() {
  info "Installing locked dependencies..."
  (cd "$PROJECT_DIR" && npm ci)

  info "Building plugin (production)..."
  (cd "$PROJECT_DIR" && npm run build)

  # Verify build artifacts
  [[ -f "$PROJECT_DIR/dist/main.js" ]]      || die "Build failed: dist/main.js not found"
  [[ -f "$PROJECT_DIR/dist/manifest.json" ]] || die "Build failed: dist/manifest.json not found"

  ok "Build succeeded"
}

# ---------------------------------------------------------------------------
# Git tag & push
# ---------------------------------------------------------------------------
create_tag() {
  local version="$1"

  # Stage and commit any uncommitted changes (source code, styles, etc.)
  local has_changes=false
  if [[ -n "$(git -C "$PROJECT_DIR" status --porcelain)" ]]; then
    has_changes=true
  fi

  if [[ "$has_changes" == "true" ]]; then
    info "Staging all changes..."
    git -C "$PROJECT_DIR" add -A

    # Show what will be committed
    echo ""
    git -C "$PROJECT_DIR" diff --cached --stat
    echo ""

    info "Committing: release $version"
    git -C "$PROJECT_DIR" commit -m "release: $version"
  fi

  # Check if tag already exists
  if git -C "$PROJECT_DIR" rev-parse "$version" >/dev/null 2>&1; then
    die "Tag $version already exists. Delete it first or choose a different version."
  fi

  info "Creating git tag: $version"
  git -C "$PROJECT_DIR" tag -a "$version" -m "$version"

  info "Pushing commits and tag to origin..."
  git -C "$PROJECT_DIR" push origin HEAD
  git -C "$PROJECT_DIR" push origin "$version"

  ok "Tag $version pushed"
}

# ---------------------------------------------------------------------------
# Resolve owner/repo from git remote (gh --repo needs "owner/repo" format)
# ---------------------------------------------------------------------------
get_gh_repo() {
  local remote_url
  remote_url=$(git -C "$PROJECT_DIR" remote get-url origin)
  echo "$remote_url" \
    | sed -E 's#^https?://github\.com/##' \
    | sed -E 's#^git@github\.com:##' \
    | sed -E 's#\.git$##'
}

# ---------------------------------------------------------------------------
# Show the single release publisher. Local uploads race CI and lack attestations.
# ---------------------------------------------------------------------------
show_release_workflow() {
  local gh_repo
  gh_repo=$(get_gh_repo)
  info "GitHub Actions will build, attest, and upload the release assets."
  info "Review and publish the draft after the workflow succeeds:"
  echo "  https://github.com/${gh_repo}/actions/workflows/release.yml"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   Obsidian Plugin Release Script             ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  check_prerequisites

  local current_version new_version
  current_version=$(get_current_version)
  info "Current version: $current_version"

  # --current mode: just build + tag + release, no version bump
  if [[ "${1:-}" == "--current" ]]; then
    new_version="$current_version"
    echo ""
    info "Release-only mode: using current version ${GREEN}$new_version${NC}"
    echo ""
    read -rp "  Build and release $new_version? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
    echo ""

    build_plugin
    create_tag "$new_version"
    show_release_workflow

    echo -e "${GREEN}🎉 Release $new_version queued in GitHub Actions!${NC}"
    echo ""
    return
  fi

  # Determine new version
  if [[ $# -ge 1 ]]; then
    case "$1" in
      major|minor|patch)
        new_version=$(bump_version "$current_version" "$1")
        ;;
      *)
        new_version="$1"
        ;;
    esac
  else
    echo ""
    echo "  How would you like to bump the version?"
    echo ""
    echo "    1) patch  → $(bump_version "$current_version" patch)"
    echo "    2) minor  → $(bump_version "$current_version" minor)"
    echo "    3) major  → $(bump_version "$current_version" major)"
    echo "    4) custom"
    echo "    5) current (no bump, just release $current_version)"
    echo ""
    read -rp "  Choose [1-5]: " choice
    case "$choice" in
      1) new_version=$(bump_version "$current_version" patch) ;;
      2) new_version=$(bump_version "$current_version" minor) ;;
      3) new_version=$(bump_version "$current_version" major) ;;
      4) read -rp "  Enter version (x.y.z): " new_version ;;
      5) new_version="$current_version" ;;
      *) die "Invalid choice" ;;
    esac
  fi

  validate_semver "$new_version"
  echo ""
  info "New version: ${GREEN}$new_version${NC}"
  echo ""

  # Confirm
  read -rp "  Proceed with release $new_version? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
  echo ""

  # Steps
  if [[ "$new_version" != "$current_version" ]]; then
    update_versions "$new_version"
  fi
  build_plugin
  create_tag "$new_version"
  show_release_workflow

  echo -e "${GREEN}🎉 Release $new_version queued in GitHub Actions!${NC}"
  echo ""
}

main "$@"

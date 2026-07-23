#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# scripts/build-pylon.sh
#
# Compile and install Pylon from source with the system's native glibc.
# Use this when the prebuilt binary fails due to glibc incompatibility.
#
# Default tag matches the Pylon version pinned in package.json.
# Override: TAG=v0.3.333 ./scripts/build-pylon.sh
#           TAG=latest    -> newest release tag from the remote
#           TAG=""        -> latest commit on the default branch
# ─────────────────────────────────────────────────────────────

REPO_DIR="${REPO_DIR:-/tmp/pylon}"
REPO_URL="${REPO_URL:-https://github.com/pylonsync/pylon.git}"
TAG="${TAG:-v0.3.333}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Colours
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

log()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

# ── Check prerequisites ─────────────────────────────────────

for cmd in rustc cargo bun git cc ldd; do
  command -v "$cmd" >/dev/null 2>&1 || err "$cmd is required but not installed"
done

log "rustc $(rustc --version | awk '{print $2}')"
log "bun $(bun --version)"

# Nothing in this script reads stdin; detach it so cargo's `rustc -` probe
# cannot consume pending terminal input when run under tmux/zellij.
exec </dev/null

if [ "$TAG" = "latest" ]; then
  TAG=$(git ls-remote --tags "$REPO_URL" | grep -oE 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' | sed 's|refs/tags/||' | sort -V | tail -1)
  [ -n "$TAG" ] || err "Could not resolve the latest release tag from $REPO_URL"
  log "Latest release: $TAG"
fi

# ── Clone / fetch the repo ──────────────────────────────────

if [ -d "$REPO_DIR" ] && git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  log "Updating existing clone at $REPO_DIR"
  cd "$REPO_DIR"
  git fetch --tags --quiet
  if [ -n "$TAG" ]; then
    git checkout --force "$TAG" 2>/dev/null || err "Tag $TAG not found — try: git fetch --tags"
  else
    git fetch --quiet --depth 1 origin HEAD
    git checkout --force FETCH_HEAD
  fi
else
  if [ -e "$REPO_DIR" ]; then
    warn "$REPO_DIR exists but is not a git clone — removing stale directory"
    rm -rf "$REPO_DIR"
  fi
  log "Cloning Pylon repo…"
  if [ -n "$TAG" ]; then
    git clone --depth 1 --branch "$TAG" "$REPO_URL" "$REPO_DIR"
  else
    git clone --depth 1 "$REPO_URL" "$REPO_DIR"
  fi
  cd "$REPO_DIR"
fi

# ── Build the Studio web UI ─────────────────────────────────

if [ -d "crates/studio_api/web" ]; then
  log "Installing Studio UI dependencies…"
  (cd crates/studio_api/web && bun install --frozen-lockfile >/dev/null 2>&1)
  log "Building Studio UI…"
  (cd crates/studio_api/web && bun run build >/dev/null 2>&1)
else
  warn "crates/studio_api/web not found — skipping Studio UI build"
fi

# ── Build the Rust binary ───────────────────────────────────

log "Compiling Pylon (release mode)…"
cargo build --release --bin pylon

# ── Install ─────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"
if [ -f "target/release/pylon" ]; then
  # Keep a timestamped backup of any previous binary
  if [ -f "$INSTALL_DIR/pylon" ]; then
    cp "$INSTALL_DIR/pylon" "$INSTALL_DIR/pylon.backup-$(date +%Y%m%d-%H%M%S)"
    log "Previous binary backed up"
  fi
  cp "target/release/pylon" "$INSTALL_DIR/pylon"
  chmod +x "$INSTALL_DIR/pylon"
  log "Installed to $INSTALL_DIR/pylon"
else
  err "Binary not found at target/release/pylon"
fi

# ── Verify ──────────────────────────────────────────────────

echo ""
if "$INSTALL_DIR/pylon" --help >/dev/null 2>&1; then
  version=$("$INSTALL_DIR/pylon" --version 2>/dev/null || echo "unknown")
  log "Pylon $version — ready"
  ldd_output=$(ldd "$INSTALL_DIR/pylon" 2>&1)
  if grep -q "not found" <<<"$ldd_output"; then
    printf '%s\n' "$ldd_output" >&2
    warn "Some libraries are missing"
  else
    log "All shared libraries resolved"
  fi
else
  err "Binary failed to execute"
fi

#!/usr/bin/env bash
# upgrade-prod.sh — pull, build, and restart the production manager checkout
# (/var/lib/smolvm-manager) as the smolvm-manager user, then verify the build
# that is actually serving through the public /api/health probe.
#
# Must run as root (uses runuser/sudo for the unprivileged steps). Overrides:
#   PROD_DIR, PROD_USER, SERVICE, HEALTH_URL, BUN
set -euo pipefail

PROD_DIR="${PROD_DIR:-/var/lib/smolvm-manager}"
PROD_USER="${PROD_USER:-smolvm-manager}"
SERVICE="${SERVICE:-smolvm-manager}"

log() { printf '[upgrade-prod] %s\n' "$*"; }
fail() { printf '[upgrade-prod] ERROR: %s\n' "$*" >&2; exit 1; }

if command -v runuser >/dev/null 2>&1; then
    as_prod() { runuser -u "$PROD_USER" -- "$@"; }
else
    as_prod() { sudo -u "$PROD_USER" "$@"; }
fi

BUN="${BUN:-$(command -v bun || true)}"
[[ -n "$BUN" && -x "$BUN" ]] || BUN=/usr/local/bin/bun
[[ -x "$BUN" ]] || fail "bun not found (set BUN=/path/to/bun)"

if [[ -z "${HEALTH_URL:-}" ]]; then
    port=""
    if [[ -r /etc/smolvm-manager/env ]]; then
        port="$(awk -F= '/^MANAGER_PORT=/ {print $2}' /etc/smolvm-manager/env | tail -1)"
    fi
    HEALTH_URL="http://127.0.0.1:${port:-4173}/api/health"
fi

[[ -d "$PROD_DIR/.git" ]] || fail "$PROD_DIR is not a git checkout"

before="$(as_prod git -C "$PROD_DIR" rev-parse --short HEAD)"
log "current checkout: $before"

if [[ -n "$(as_prod git -C "$PROD_DIR" status --porcelain)" ]]; then
    fail "working tree is dirty; commit or stash local changes in $PROD_DIR first"
fi

as_prod git -C "$PROD_DIR" pull --ff-only
after="$(as_prod git -C "$PROD_DIR" rev-parse --short HEAD)"
log "pulled: $before -> $after"

if [[ "$before" != "$after" ]]; then
    if as_prod git -C "$PROD_DIR" diff --name-only "$before" "$after" \
        | grep -qE '^(package\.json|bun\.lock)$'; then
        log "dependencies changed; running bun install"
        as_prod bash -lc "cd '$PROD_DIR' && '$BUN' install"
    fi

    log "building"
    as_prod bash -lc "cd '$PROD_DIR' && '$BUN' run build"

    log "restarting $SERVICE"
    systemctl restart "$SERVICE"
else
    log "already up to date; skipping build and restart"
fi

log "waiting for $SERVICE health at $HEALTH_URL"
healthy=""
for _ in $(seq 1 30); do
    if payload="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null)"; then
        healthy="$payload"
        break
    fi
    sleep 1
done
[[ -n "$healthy" ]] || fail "service did not answer $HEALTH_URL within 30s"

log "deployed $after; health: $healthy"

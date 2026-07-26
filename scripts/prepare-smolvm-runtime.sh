#!/usr/bin/env bash
set -euo pipefail

resolver_source="${SMOLVM_RESOLV_CONF:-/etc/resolv.conf}"

if [[ ! -r "$resolver_source" ]]; then
    printf '[smolvm-runtime] ERROR: resolver file is not readable: %s\n' "$resolver_source" >&2
    exit 1
fi

if ! grep -Eq '^[[:space:]]*nameserver[[:space:]]+[^[:space:]#]+' "$resolver_source"; then
    printf '[smolvm-runtime] ERROR: resolver file has no nameserver: %s\n' "$resolver_source" >&2
    exit 1
fi

patched=0
for rootfs in "$@"; do
    [[ -d "$rootfs/etc" ]] || continue
    install -m 0644 "$resolver_source" "$rootfs/etc/resolv.conf"
    printf '[smolvm-runtime] Installed host resolver in %s\n' "$rootfs"
    patched=$((patched + 1))
done

if [[ "$patched" -eq 0 ]]; then
    printf '[smolvm-runtime] ERROR: no SmolVM agent rootfs directory exists.\n' >&2
    exit 1
fi

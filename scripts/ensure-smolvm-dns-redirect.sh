#!/usr/bin/env bash
# ensure-smolvm-dns-redirect.sh — keep SmolVM guest DNS working on hosts whose
# external firewall blocks the public resolver compiled into SmolVM
# (DEFAULT_DNS_ADDR = 1.1.1.1). Guests query the TSI gateway at 100.96.0.1,
# which forwards UDP/TCP 53 to 1.1.1.1 from the host network namespace. These
# DNAT rules redirect that traffic to the host's real resolver (first IPv4
# nameserver in /etc/resolv.conf).
#
# Usage: ensure-smolvm-dns-redirect.sh [add|remove]
#   add     purge any stale rule for the compiled-in DNS, then install udp+tcp
#   remove  drop every redirect rule for the compiled-in DNS
#
# Overrides: SMOLVM_RESOLV_CONF (resolver source), SMOLVM_COMPILED_DNS (target).
set -euo pipefail

action="${1:-add}"
resolver_source="${SMOLVM_RESOLV_CONF:-/etc/resolv.conf}"
target_dns="${SMOLVM_COMPILED_DNS:-1.1.1.1}"

upstream="$(awk '/^[[:space:]]*nameserver[[:space:]]+[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/ {print $2; exit}' "$resolver_source" 2>/dev/null || true)"

if [[ "$action" == "add" ]]; then
    if [[ -z "$upstream" ]]; then
        printf '[smolvm-dns] ERROR: no IPv4 nameserver found in %s\n' "$resolver_source" >&2
        exit 1
    fi
    if [[ "$upstream" == "$target_dns" ]]; then
        printf '[smolvm-dns] host resolver is already %s; no redirect needed\n' "$target_dns"
        exit 0
    fi
fi

# Drop every DNAT rule for the compiled-in DNS, whatever its current target,
# so a resolver change never leaves a stale first-match rule behind.
purge_existing() {
    iptables -t nat -S OUTPUT \
        | grep -- "-d ${target_dns}" \
        | grep -- "--dport 53" \
        | grep DNAT \
        | while read -r rule; do
            # shellcheck disable=SC2086 # intentional word splitting of the rule
            iptables -t nat ${rule/#-A/-D}
        done || true
}

case "$action" in
    add)
        purge_existing
        iptables -t nat -A OUTPUT -p udp -d "$target_dns" --dport 53 -j DNAT --to-destination "${upstream}:53"
        iptables -t nat -A OUTPUT -p tcp -d "$target_dns" --dport 53 -j DNAT --to-destination "${upstream}:53"
        printf '[smolvm-dns] DNAT %s:53 -> %s:53 (udp+tcp)\n' "$target_dns" "$upstream"
        ;;
    remove)
        purge_existing
        ;;
    *)
        printf 'usage: %s [add|remove]\n' "$0" >&2
        exit 2
        ;;
esac

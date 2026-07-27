import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Minimal iptables double: -C checks the state file, -A appends, -D deletes,
// -S prints rules in `iptables -S` format (`-A OUTPUT ...`).
const IPTABLES_STUB = `#!/usr/bin/env bash
state="\${IPTABLES_STATE:?}"
touch "$state"
op=""
for a in "$@"; do
  case "$a" in -C|-A|-D|-S) op="$a"; break ;; esac
done
seen=false
out=()
for a in "$@"; do
  if $seen; then out+=("$a"); fi
  if [[ "$a" == "$op" ]]; then seen=true; fi
done
rest="\${out[*]}"
case "$op" in
  -C) grep -qF -- "$rest" "$state" ;;
  -A) printf '%s\\n' "$rest" >> "$state" ;;
  -D) grep -vF -- "$rest" "$state" > "$state.tmp" || true; mv "$state.tmp" "$state" ;;
  -S) while IFS= read -r line; do printf -- '-A %s\\n' "$line"; done < "$state" ;;
esac
`;

async function setup(resolvConf: string) {
  const root = await mkdtemp(join(tmpdir(), 'smolvm-dns-redirect-'));
  const bin = join(root, 'bin');
  const resolver = join(root, 'resolv.conf');
  const state = join(root, 'iptables-state');
  await mkdir(bin);
  await writeFile(join(bin, 'iptables'), IPTABLES_STUB);
  await chmod(join(bin, 'iptables'), 0o755);
  await writeFile(resolver, resolvConf);
  return { root, bin, resolver, state };
}

async function run(bin: string, resolver: string, state: string, action: string) {
  const child = Bun.spawn(['bash', 'scripts/ensure-smolvm-dns-redirect.sh', action], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SMOLVM_RESOLV_CONF: resolver,
      IPTABLES_STATE: state
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  return child.exited;
}

test('dns redirect add installs udp+tcp DNAT rules to the host resolver and is idempotent', async () => {
  const { root, bin, resolver, state } = await setup('nameserver 185.12.64.1\n');
  try {
    expect(await run(bin, resolver, state, 'add')).toBe(0);
    expect(await run(bin, resolver, state, 'add')).toBe(0);

    const rules = (await readFile(state, 'utf8')).trim().split('\n');
    expect(rules).toHaveLength(2);
    expect(rules).toContain(
      'OUTPUT -p udp -d 1.1.1.1 --dport 53 -j DNAT --to-destination 185.12.64.1:53'
    );
    expect(rules).toContain(
      'OUTPUT -p tcp -d 1.1.1.1 --dport 53 -j DNAT --to-destination 185.12.64.1:53'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dns redirect add replaces a stale rule pointing at a previous resolver', async () => {
  const { root, bin, resolver, state } = await setup('nameserver 185.12.64.1\n');
  try {
    await writeFile(
      state,
      'OUTPUT -p udp -d 1.1.1.1 --dport 53 -j DNAT --to-destination 8.8.8.8:53\n'
    );

    expect(await run(bin, resolver, state, 'add')).toBe(0);

    const content = await readFile(state, 'utf8');
    expect(content).not.toContain('8.8.8.8');
    expect(content).toContain('185.12.64.1:53');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dns redirect remove drops every rule for the compiled-in resolver', async () => {
  const { root, bin, resolver, state } = await setup('nameserver 185.12.64.1\n');
  try {
    expect(await run(bin, resolver, state, 'add')).toBe(0);
    expect(await run(bin, resolver, state, 'remove')).toBe(0);
    expect((await readFile(state, 'utf8')).trim()).toBe('');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dns redirect add fails when the resolver has no IPv4 nameserver', async () => {
  const { root, bin, resolver, state } = await setup('nameserver 2a01:4ff:ff00::add:2\n');
  try {
    expect(await run(bin, resolver, state, 'add')).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

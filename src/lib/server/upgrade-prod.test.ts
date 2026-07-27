import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Stubs record every invocation in $UPGRADE_LOG so the test can assert the
// exact sequence of external commands the script performs.
const RUNUSER_STUB = `#!/usr/bin/env bash
shift 3
exec "$@"
`;

const GIT_STUB = `#!/usr/bin/env bash
echo "git $*" >> "$UPGRADE_LOG"
args=("$@")
while [[ "\${args[0]:-}" == "-C" ]]; do args=("\${args[@]:2}"); done
case "\${args[0]:-}" in
  rev-parse) cat "$GIT_HASH_FILE" ;;
  status) [[ -f "$GIT_DIRTY_FILE" ]] && cat "$GIT_DIRTY_FILE" || true ;;
  pull) echo "$GIT_AFTER_HASH" > "$GIT_HASH_FILE" ;;
  diff) [[ -f "$GIT_CHANGED_FILE" ]] && cat "$GIT_CHANGED_FILE" || true ;;
esac
`;

const RECORDER_STUB = `#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$UPGRADE_LOG"
`;

const CURL_STUB = `#!/usr/bin/env bash
echo "curl $*" >> "$UPGRADE_LOG"
printf '{"commit":"bbb222","buildTime":"t","smolvm":{"reachable":true,"version":"1.7.0"}}'
`;

async function setup(options: { dirty?: boolean; changed?: string; afterHash?: string }) {
  const root = await mkdtemp(join(tmpdir(), 'upgrade-prod-'));
  const bin = join(root, 'bin');
  const prodDir = join(root, 'prod');
  await mkdir(bin);
  await mkdir(join(prodDir, '.git'), { recursive: true });

  const stubs: Record<string, string> = {
    runuser: RUNUSER_STUB,
    git: GIT_STUB,
    bun: RECORDER_STUB,
    systemctl: RECORDER_STUB,
    curl: CURL_STUB
  };
  for (const [name, content] of Object.entries(stubs)) {
    await writeFile(join(bin, name), content);
    await chmod(join(bin, name), 0o755);
  }

  const hashFile = join(root, 'hash');
  await writeFile(hashFile, 'aaa111\n');
  if (options.dirty) await writeFile(join(root, 'dirty'), ' M static/favicon.png\n');
  if (options.changed !== undefined) await writeFile(join(root, 'changed'), options.changed);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PROD_DIR: prodDir,
    PROD_USER: 'tester',
    HEALTH_URL: 'http://127.0.0.1:1/api/health',
    BUN: join(bin, 'bun'),
    UPGRADE_LOG: join(root, 'log'),
    GIT_HASH_FILE: hashFile,
    GIT_AFTER_HASH: options.afterHash ?? 'bbb222',
    ...(options.dirty ? { GIT_DIRTY_FILE: join(root, 'dirty') } : {}),
    ...(options.changed !== undefined ? { GIT_CHANGED_FILE: join(root, 'changed') } : {})
  };

  return { root, env, logPath: join(root, 'log') };
}

async function run(env: NodeJS.ProcessEnv) {
  const child = Bun.spawn(['bash', 'scripts/upgrade-prod.sh'], {
    cwd: process.cwd(),
    env,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const code = await child.exited;
  const stdout = await new Response(child.stdout).text();
  return { code, stdout };
}

test('upgrade-prod pulls, installs deps, builds, restarts and probes health', async () => {
  const { root, env, logPath } = await setup({ changed: 'package.json\nsrc/x.ts\n' });
  try {
    const { code, stdout } = await run(env);
    expect(code).toBe(0);

    const log = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(log).toEqual([
      'git -C ' + env.PROD_DIR + ' rev-parse --short HEAD',
      'git -C ' + env.PROD_DIR + ' status --porcelain',
      'git -C ' + env.PROD_DIR + ' pull --ff-only',
      'git -C ' + env.PROD_DIR + ' rev-parse --short HEAD',
      'git -C ' + env.PROD_DIR + ' diff --name-only aaa111 bbb222',
      'bun install',
      'bun run build',
      'systemctl restart smolvm-manager',
      expect.stringContaining('curl')
    ]);
    expect(stdout).toContain('aaa111 -> bbb222');
    expect(stdout).toContain('deployed bbb222');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('upgrade-prod skips install when dependencies are untouched', async () => {
  const { root, env, logPath } = await setup({ changed: 'src/routes/+page.svelte\n' });
  try {
    const { code } = await run(env);
    expect(code).toBe(0);

    const log = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(log).not.toContain('bun install');
    expect(log).toContain('bun run build');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('upgrade-prod refuses a dirty working tree before pulling', async () => {
  const { root, env, logPath } = await setup({ dirty: true });
  try {
    const { code } = await run(env);
    expect(code).toBe(1);

    const log = await readFile(logPath, 'utf8');
    expect(log).not.toContain('pull');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('upgrade-prod skips build and restart when already up to date', async () => {
  const { root, env, logPath } = await setup({ changed: '', afterHash: 'aaa111' });
  try {
    const { code, stdout } = await run(env);
    expect(code).toBe(0);

    const log = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(log).not.toContain('bun run build');
    expect(log).not.toContain('systemctl restart smolvm-manager');
    expect(stdout).toContain('already up to date');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

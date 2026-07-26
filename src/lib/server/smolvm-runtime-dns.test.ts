import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('SmolVM runtime preparation installs the host resolver in every existing agent rootfs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'smolvm-runtime-dns-'));
  const resolver = join(root, 'resolv.conf');
  const installedRootfs = join(root, 'installed-rootfs');
  const cachedRootfs = join(root, 'cached-rootfs');

  try {
    await mkdir(join(installedRootfs, 'etc'), { recursive: true });
    await mkdir(join(cachedRootfs, 'etc'), { recursive: true });
    await writeFile(resolver, 'nameserver 185.12.64.1\n');
    await writeFile(join(installedRootfs, 'etc/resolv.conf'), 'nameserver 1.1.1.1\n');
    await writeFile(join(cachedRootfs, 'etc/resolv.conf'), 'nameserver 1.1.1.1\n');

    const child = Bun.spawn(
      ['bash', 'scripts/prepare-smolvm-runtime.sh', installedRootfs, cachedRootfs],
      {
        cwd: process.cwd(),
        env: { ...process.env, SMOLVM_RESOLV_CONF: resolver },
        stdout: 'pipe',
        stderr: 'pipe'
      }
    );

    expect(await child.exited).toBe(0);
    expect(await readFile(join(installedRootfs, 'etc/resolv.conf'), 'utf8')).toBe(
      'nameserver 185.12.64.1\n'
    );
    expect(await readFile(join(cachedRootfs, 'etc/resolv.conf'), 'utf8')).toBe(
      'nameserver 185.12.64.1\n'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

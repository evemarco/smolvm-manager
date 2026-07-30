import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSmolVmMachineUpdate } from './smolvm-machine-update';

const ORIGINAL_UPDATE_HOME = process.env.SMOLVM_UPDATE_HOME;
const ORIGINAL_UPDATE_CWD = process.env.SMOLVM_UPDATE_CWD;

afterEach(() => {
  if (ORIGINAL_UPDATE_HOME === undefined) delete process.env.SMOLVM_UPDATE_HOME;
  else process.env.SMOLVM_UPDATE_HOME = ORIGINAL_UPDATE_HOME;
  if (ORIGINAL_UPDATE_CWD === undefined) delete process.env.SMOLVM_UPDATE_CWD;
  else process.env.SMOLVM_UPDATE_CWD = ORIGINAL_UPDATE_CWD;
});

describe('runSmolVmMachineUpdate', () => {
  test('runs the update command with configured SmolVM home and cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'smolvm-update-runner-'));
    const workdir = join(root, 'work');
    const home = join(root, 'home');
    const outputPath = join(root, 'runner-output.txt');
    const scriptPath = join(root, 'capture-env.sh');

    await Bun.write(scriptPath, `#!/bin/sh\nprintf '%s\\n%s\\n' "$PWD" "$HOME" > "$1"\n`);
    chmodSync(scriptPath, 0o700);
    mkdirSync(workdir);
    mkdirSync(home);

    process.env.SMOLVM_UPDATE_CWD = workdir;
    process.env.SMOLVM_UPDATE_HOME = home;

    try {
      await runSmolVmMachineUpdate([scriptPath, outputPath]);

      expect(await Bun.file(outputPath).text()).toBe(`${workdir}\n${home}\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

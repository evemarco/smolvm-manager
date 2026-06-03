import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startPylon,
  type ChildProcessLike,
  type PylonConfig,
  type SpawnRequest
} from './pylon-lifecycle';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pylon lifecycle builds expected spawn arguments and database env', async () => {
  const config = makeConfig();
  const requests: SpawnRequest[] = [];

  const lifecycle = await startPylon({
    config,
    commandExists: () => true,
    spawn: (request) => {
      requests.push(request);
      return makeChild(4242);
    }
  });

  expect(lifecycle.status).toBe('started');
  expect(requests).toHaveLength(1);
  expect(requests[0].command).toEqual(['/opt/pylon', 'dev', 'app.ts']);
  expect(requests[0].cwd).toBe(config.cwd);
  expect(requests[0].env.PYLON_DB_PATH).toBe('./data/app.db');
  expect(requests[0].env.PYLON_SESSION_DB).toBe('./data/session.db');
  expect(readFileSync(config.pidFile, 'utf8')).toBe('4242\n');
});

test('pylon lifecycle prevents duplicate starts when pid file is alive', async () => {
  const config = makeConfig();
  writeFileSync(config.pidFile, '7777\n', 'utf8');
  let spawnCalls = 0;

  const lifecycle = await startPylon({
    config,
    commandExists: () => true,
    isProcessRunning: (pid) => pid === 7777,
    spawn: () => {
      spawnCalls += 1;
      return makeChild(9999);
    }
  });

  expect(lifecycle.status).toBe('already-running');
  expect(lifecycle.pid).toBe(7777);
  expect(spawnCalls).toBe(0);
});

test('pylon lifecycle gracefully shuts down child with requested signal', async () => {
  const config = makeConfig();
  const killedSignals: NodeJS.Signals[] = [];

  const lifecycle = await startPylon({
    config,
    commandExists: () => true,
    spawn: () => makeChild(5151, killedSignals)
  });

  await lifecycle.shutdown('SIGINT');

  expect(killedSignals).toEqual(['SIGINT']);
});

test('pylon lifecycle reports actionable error when command is missing', async () => {
  const config = makeConfig({ command: 'missing-pylon' });

  try {
    await startPylon({
      config,
      commandExists: () => false,
      spawn: () => makeChild(1)
    });
    throw new Error('Expected startPylon to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Pylon command 'missing-pylon' was not found");
  }
});

function makeConfig(overrides: Partial<PylonConfig> = {}): PylonConfig {
  const root = mkdtempSync(join(tmpdir(), 'smolvm-pylon-'));
  tempRoots.push(root);

  return {
    command: '/opt/pylon',
    appFile: 'app.ts',
    dbPath: './data/app.db',
    sessionDb: './data/session.db',
    pidFile: join(root, 'pylon.pid'),
    cwd: root,
    ...overrides
  };
}

function makeChild(pid: number, killedSignals: NodeJS.Signals[] = []): ChildProcessLike {
  return {
    pid,
    kill(signal = 'SIGTERM') {
      killedSignals.push(signal);
    }
  };
}

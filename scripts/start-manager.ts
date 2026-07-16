import process from 'node:process';

import { startPylon, type ChildProcessLike } from '../src/lib/server/pylon-lifecycle';

type SvelteKitMode = 'dev' | 'prod';
type ManagerSpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: 'inherit';
  stderr: 'inherit';
};

declare const Bun: {
  spawn(command: string[], options: ManagerSpawnOptions): ChildProcessLike;
};

const mode: SvelteKitMode = process.argv.includes('--prod') ? 'prod' : 'dev';

const managerHost = process.env.MANAGER_HOST || '0.0.0.0';
const managerPort = process.env.MANAGER_PORT || (mode === 'prod' ? '4173' : '3000');

let shuttingDown = false;
let pylon: Awaited<ReturnType<typeof startPylon>> | undefined;
let svelteKit: ChildProcessLike | undefined;

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[manager] ${message}`);
  process.exit(1);
});

async function main(): Promise<void> {
  pylon = await startPylon({ config: getPylonConfigForStartup() });
  svelteKit = startSvelteKit(mode);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  if (pylon.child?.exited) {
    void pylon.child.exited.then((code) => {
      if (shuttingDown) return;

      console.error(`[manager] Pylon exited unexpectedly with code ${code}; stopping SvelteKit`);
      void shutdown('SIGTERM', code === 0 ? 1 : code);
    });
  }

  const exitCode = await (svelteKit.exited ?? Promise.resolve(0));
  await shutdown('SIGTERM', exitCode);
}

function getPylonConfigForStartup() {
  return {
    command: process.env.PYLON_COMMAND?.trim() || 'pylon',
    appFile: process.env.PYLON_APP_FILE?.trim() || 'app.ts',
    dbPath: process.env.PYLON_DB_PATH?.trim() || './data/pylon-app.db',
    sessionDb: process.env.PYLON_SESSION_DB?.trim() || './data/pylon-sessions.db',
    pidFile: process.env.PYLON_PID_FILE?.trim() || `${process.cwd()}/.pylon/pylon.pid`,
    cwd: process.cwd()
  };
}

function startSvelteKit(runMode: SvelteKitMode): ChildProcessLike {
  const command =
    runMode === 'prod'
      ? [
          'bun',
          'x',
          'vite',
          'preview',
          '--host',
          managerHost,
          '--port',
          managerPort,
          '--strictPort'
        ]
      : ['bun', 'x', 'vite', 'dev', '--host', managerHost, '--port', managerPort, '--strictPort'];

  console.log(`[manager] Starting SvelteKit ${runMode} server on ${managerHost}:${managerPort}`);

  return Bun.spawn(command, {
    cwd: process.cwd(),
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit'
  });
}

async function shutdown(signal: 'SIGINT' | 'SIGTERM', code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[manager] Shutting down after ${signal}`);
  svelteKit?.kill(signal);
  await pylon?.shutdown(signal);
  process.exit(code);
}

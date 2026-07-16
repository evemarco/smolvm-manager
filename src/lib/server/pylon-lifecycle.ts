import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

export type LifecycleSignal = 'SIGINT' | 'SIGTERM';

export type ChildProcessLike = {
  pid?: number;
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
  exited?: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
};

export type SpawnRequest = {
  command: string[];
  cwd: string;
  env: Record<string, string>;
  stdout: 'pipe';
  stderr: 'pipe';
};

export type PylonConfig = {
  command: string;
  appFile: string;
  dbPath: string;
  sessionDb: string;
  pidFile: string;
  cwd: string;
};

export type PylonLifecycleOptions = {
  config: PylonConfig;
  spawn?: (request: SpawnRequest) => ChildProcessLike;
  isProcessRunning?: (pid: number) => boolean;
  commandExists?: (command: string, envPath: string | undefined) => boolean;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type PylonLifecycle = {
  status: 'started' | 'already-running';
  pid?: number;
  child?: ChildProcessLike;
  shutdown: (signal?: LifecycleSignal) => Promise<void>;
};

const defaultPidFile = join(process.cwd(), '.pylon', 'pylon.pid');

export function getPylonConfig(env: NodeJS.ProcessEnv = process.env): PylonConfig {
  return {
    command: env.PYLON_COMMAND?.trim() || 'pylon',
    appFile: env.PYLON_APP_FILE?.trim() || 'app.ts',
    dbPath: env.PYLON_DB_PATH?.trim() || './data/pylon-app.db',
    sessionDb: env.PYLON_SESSION_DB?.trim() || './data/pylon-sessions.db',
    pidFile: env.PYLON_PID_FILE?.trim() || defaultPidFile,
    cwd: env.MANAGER_ROOT?.trim() || process.cwd()
  };
}

export function buildPylonSpawnRequest(config: PylonConfig): SpawnRequest {
  return {
    command: [config.command, 'dev', config.appFile],
    cwd: config.cwd,
    env: {
      ...process.env,
      PYLON_DB_PATH: config.dbPath,
      PYLON_SESSION_DB: config.sessionDb
    } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe'
  };
}

export function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function defaultCommandExists(command: string, envPath = process.env.PATH): boolean {
  if (!command) return false;

  if (isAbsolute(command) || command.includes('/')) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  return (envPath ?? '')
    .split(':')
    .filter(Boolean)
    .some((pathPart) => {
      try {
        accessSync(join(pathPart, command), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

export async function startPylon(options: PylonLifecycleOptions): Promise<PylonLifecycle> {
  const config = options.config;
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  const spawn = options.spawn ?? ((request) => Bun.spawn(request.command, request));
  const isProcessRunning = options.isProcessRunning ?? defaultIsProcessRunning;
  const commandExists = options.commandExists ?? defaultCommandExists;

  const existingPid = readPid(config.pidFile);
  if (existingPid && isProcessRunning(existingPid)) {
    log(`[pylon] Reusing existing Pylon process ${existingPid} from ${config.pidFile}`);
    return {
      status: 'already-running',
      pid: existingPid,
      shutdown: async () => undefined
    };
  }

  if (existingPid) rmSync(config.pidFile, { force: true });

  if (!commandExists(config.command, process.env.PATH)) {
    throw new Error(
      `Pylon command '${config.command}' was not found or is not executable. Set PYLON_COMMAND to the Pylon binary path, then retry bun run dev:manager.`
    );
  }

  mkdirSync(dirname(config.pidFile), { recursive: true });

  const request = buildPylonSpawnRequest(config);
  const child = spawn(request);

  if (!child.pid) {
    throw new Error('Pylon process started without a pid; cannot write lifecycle lock file.');
  }

  writeFileSync(config.pidFile, `${child.pid}\n`, 'utf8');
  forwardStream(child.stdout, log, '[pylon]');
  forwardStream(child.stderr, error, '[pylon:error]');
  void child.exited?.finally(() => rmSync(config.pidFile, { force: true }));

  return {
    status: 'started',
    pid: child.pid,
    child,
    shutdown: async (signal = 'SIGTERM') => {
      child.kill(signal);
      await waitForExit(child, 5000);
      rmSync(config.pidFile, { force: true });
    }
  };
}

function readPid(pidFile: string): number | undefined {
  if (!existsSync(pidFile)) return undefined;

  const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function forwardStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  writer: (message: string) => void,
  prefix: string
): void {
  if (!stream) return;

  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      const text = decoder.decode(chunk).trimEnd();
      if (text) writer(`${prefix} ${text}`);
    }
  })();
}

async function waitForExit(child: ChildProcessLike, timeoutMs: number): Promise<void> {
  if (!child.exited) return;

  await Promise.race([
    child.exited.catch(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, timeoutMs);
    })
  ]);
}

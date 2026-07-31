import { SmolVmError, SMOLVM_ERROR_CODES } from '$lib/server/smolvm-client';
import {
  diffConfigs,
  machineResponseToConfig,
  type ConfigDiff,
  type VmConfig,
  type VmPortMapping,
  type VmVolumeMount
} from '$lib/server/vm-config';

export type SmolVmMachineUpdateRunner = (command: readonly string[]) => Promise<void>;

export type SmolVmMachineUpdatePlan = {
  readonly command: readonly string[];
  readonly recreateRequired: readonly ConfigDiff[];
  readonly unsupportedLiveUpdate: readonly ConfigDiff[];
};

const IGNORABLE_UNKNOWN_ORIGINAL_FIELDS = new Set<keyof VmConfig>(['image', 'tag']);
const IGNORABLE_UNKNOWN_FALSE_FIELDS = new Set<keyof VmConfig>(['sshAgent']);

const UPDATE_SUPPORTED_FIELDS = new Set<keyof VmConfig>([
  'cpus',
  'memory',
  'storage',
  'overlay',
  'net',
  'gpu',
  'ports',
  'volumes',
  'env',
  'workdir'
]);

function portKey(port: VmPortMapping): string {
  return `${port.host}:${port.guest}`;
}

function volumeKey(volume: VmVolumeMount): string {
  return `${volume.host}:${volume.guest}${volume.readOnly ? ':ro' : ''}`;
}

function volumeRemovalKey(volume: VmVolumeMount): string {
  return `${volume.host}:${volume.guest}`;
}

function appendScalarUpdateArgs(args: string[], config: VmConfig): void {
  if (config.cpus !== undefined) args.push('--cpus', String(config.cpus));
  if (config.memory !== undefined) args.push('--mem', String(config.memory));
  if (config.storage !== undefined) args.push('--storage', String(config.storage));
  if (config.overlay !== undefined) args.push('--overlay', String(config.overlay));
  if (config.net !== undefined) args.push(config.net ? '--net' : '--no-net');
  if (config.gpu !== undefined) args.push(config.gpu ? '--gpu' : '--no-gpu');
  if (config.workdir) args.push('--workdir', config.workdir);
}

function appendPortUpdateArgs(args: string[], original: VmConfig, updated: VmConfig): void {
  const oldPorts = new Set((original.ports ?? []).map(portKey));
  const newPorts = new Set((updated.ports ?? []).map(portKey));

  for (const port of oldPorts) {
    if (!newPorts.has(port)) args.push('--remove-port', port);
  }
  for (const port of newPorts) {
    if (!oldPorts.has(port)) args.push('--port', port);
  }
}

function appendVolumeUpdateArgs(args: string[], original: VmConfig, updated: VmConfig): void {
  const oldVolumes = new Map((original.volumes ?? []).map((volume) => [volumeKey(volume), volume]));
  const newVolumes = new Map((updated.volumes ?? []).map((volume) => [volumeKey(volume), volume]));

  for (const [key, volume] of oldVolumes) {
    if (!newVolumes.has(key)) args.push('--remove-volume', volumeRemovalKey(volume));
  }
  for (const [key, volume] of newVolumes) {
    if (!oldVolumes.has(key)) args.push('--volume', key);
  }
}

function appendEnvUpdateArgs(args: string[], original: VmConfig, updated: VmConfig): void {
  const oldEnv = original.env ?? {};
  const newEnv = updated.env ?? {};

  for (const key of Object.keys(oldEnv)) {
    if (!(key in newEnv)) args.push('--remove-env', key);
  }
  for (const [key, value] of Object.entries(newEnv)) {
    if (oldEnv[key] !== value) args.push('--env', `${key}=${value}`);
  }
}

export function buildMachineUpdatePlan(
  machine: Record<string, unknown>,
  updated: VmConfig
): SmolVmMachineUpdatePlan {
  const original = machineResponseToConfig(machine);
  const diffs = diffConfigs(original, updated);
  const recreateRequired = diffs.filter(
    (diff) =>
      diff.requiresRecreate &&
      !(diff.oldValue === undefined && IGNORABLE_UNKNOWN_ORIGINAL_FIELDS.has(diff.field))
  );
  const unsupportedLiveUpdate = diffs.filter(
    (diff) =>
      !diff.requiresRecreate &&
      !UPDATE_SUPPORTED_FIELDS.has(diff.field) &&
      !(
        diff.oldValue === undefined &&
        diff.newValue === false &&
        IGNORABLE_UNKNOWN_FALSE_FIELDS.has(diff.field)
      )
  );
  const command = [getSmolVmCommand(), 'machine', 'update', '--name', original.name];

  appendScalarUpdateArgs(command, updated);
  appendPortUpdateArgs(command, original, updated);
  appendVolumeUpdateArgs(command, original, updated);
  appendEnvUpdateArgs(command, original, updated);

  return { command, recreateRequired, unsupportedLiveUpdate };
}

export function getSmolVmCommand(): string {
  return process.env.SMOLVM_COMMAND?.trim() || 'smolvm';
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const runSmolVmMachineUpdate: SmolVmMachineUpdateRunner = async (command) => {
  const updateHome = getOptionalEnv('SMOLVM_UPDATE_HOME');
  const updateCwd = getOptionalEnv('SMOLVM_UPDATE_CWD');
  const updateSudo = getOptionalEnv('SMOLVM_UPDATE_SUDO') === 'true';
  // Resource changes (cpus/mem/storage/overlay/net) make the CLI read per-VM
  // cache dirs owned by a mapped uid with mode 700 — root via sudo is required.
  const argv = updateSudo
    ? ['sudo', '-n', ...(updateHome ? [`HOME=${updateHome}`] : []), ...command]
    : [...command];
  const proc = Bun.spawn(argv, {
    ...(updateCwd ? { cwd: updateCwd } : {}),
    ...(updateHome && !updateSudo ? { env: { ...process.env, HOME: updateHome } } : {}),
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode === 0) return;

  const detail = stderr.trim() || stdout.trim() || `smolvm exited with status ${exitCode}`;
  throw new SmolVmError(SMOLVM_ERROR_CODES.REQUEST_FAILED, detail, exitCode === 127 ? 503 : 502, {
    exitCode,
    command: argv.join(' '),
    ...(updateCwd ? { cwd: updateCwd } : {}),
    ...(updateHome ? { home: updateHome } : {})
  });
};

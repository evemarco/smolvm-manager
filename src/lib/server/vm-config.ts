/**
 * VM configuration types, TOML serialization/deserialization, and validation
 * for SmolVM Manager.
 *
 * SmolVM supports these v1 config fields:
 * - name, image/tag, from (.smolmachine), cpus, memory (MiB), storage (GiB),
 *   overlay (GiB), net, allow_hosts, allow_cidrs, ports, volumes, env,
 *   workdir, init, ssh_agent, gpu, gpu_vram (MiB), entrypoint, cmd
 *
 * Fields that require recreation (cannot be updated on a running/stopped VM):
 * - image, entrypoint, cmd, from
 *
 * All other fields can be updated via `smolvm machine update`.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type VmPortMapping = {
  host: number;
  guest: number;
};

export type VmVolumeMount = {
  host: string;
  guest: string;
  readOnly?: boolean;
};

export type VmConfig = {
  name: string;
  image?: string;
  tag?: string;
  from?: string;
  cpus?: number;
  memory?: number; // MiB
  storage?: number; // GiB
  overlay?: number; // GiB
  net?: boolean;
  gpu?: boolean;
  gpuVram?: number; // MiB
  allowHosts?: string[];
  allowCidrs?: string[];
  ports?: VmPortMapping[];
  volumes?: VmVolumeMount[];
  env?: Record<string, string>;
  workdir?: string;
  init?: string[];
  sshAgent?: boolean;
  entrypoint?: string;
  cmd?: string;
};

/** Fields that cannot be changed via update — require VM recreation. */
export const RECREATE_REQUIRED_FIELDS = new Set(['image', 'tag', 'from', 'entrypoint', 'cmd']);

export type VmConfigField = keyof VmConfig;

export type ConfigDiff = {
  field: VmConfigField;
  oldValue: unknown;
  newValue: unknown;
  requiresRecreate: boolean;
};

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

// ─── Validation ──────────────────────────────────────────────────────────────

const VALID_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;
const VALID_CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const VALID_HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/;

export function validateVmConfig(config: VmConfig): ValidationResult {
  const errors: ValidationError[] = [];

  // Name is required
  if (!config.name || !config.name.trim()) {
    errors.push({ field: 'name', message: 'Machine name is required.' });
  } else if (!VALID_NAME_RE.test(config.name)) {
    errors.push({
      field: 'name',
      message:
        'Machine name must start with an alphanumeric character and contain only letters, digits, underscores, periods, and hyphens (max 63 characters).'
    });
  }

  // Image or from is needed for creation
  if (!config.image && !config.from) {
    // Allow empty for editing existing VMs, but warn for creation
  }

  // Numeric fields
  if (config.cpus !== undefined && (config.cpus < 1 || config.cpus > 64)) {
    errors.push({ field: 'cpus', message: 'CPUs must be between 1 and 64.' });
  }
  if (config.memory !== undefined && config.memory < 64) {
    errors.push({ field: 'memory', message: 'Memory must be at least 64 MiB.' });
  }
  if (config.storage !== undefined && config.storage < 1) {
    errors.push({ field: 'storage', message: 'Storage must be at least 1 GiB.' });
  }
  if (config.overlay !== undefined && config.overlay < 1) {
    errors.push({ field: 'overlay', message: 'Overlay must be at least 1 GiB.' });
  }
  if (config.gpuVram !== undefined && config.gpuVram < 1) {
    errors.push({ field: 'gpuVram', message: 'GPU VRAM must be at least 1 MiB.' });
  }

  // Port mappings
  if (config.ports) {
    for (const port of config.ports) {
      if (port.host < 1 || port.host > 65535) {
        errors.push({
          field: 'ports',
          message: `Host port ${port.host} must be between 1 and 65535.`
        });
      }
      if (port.guest < 1 || port.guest > 65535) {
        errors.push({
          field: 'ports',
          message: `Guest port ${port.guest} must be between 1 and 65535.`
        });
      }
    }
  }

  // Volume mounts
  if (config.volumes) {
    for (const vol of config.volumes) {
      if (!vol.host || !vol.guest) {
        errors.push({
          field: 'volumes',
          message: 'Volume mount must have both host and guest paths.'
        });
      }
    }
  }

  // CIDR validation
  if (config.allowCidrs) {
    for (const cidr of config.allowCidrs) {
      if (!VALID_CIDR_RE.test(cidr)) {
        errors.push({
          field: 'allowCidrs',
          message: `Invalid CIDR range: "${cidr}".`
        });
      }
    }
  }

  // Host validation
  if (config.allowHosts) {
    for (const host of config.allowHosts) {
      if (!VALID_HOST_RE.test(host)) {
        errors.push({
          field: 'allowHosts',
          message: `Invalid hostname: "${host}".`
        });
      }
    }
  }

  // Env keys
  if (config.env) {
    for (const key of Object.keys(config.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        errors.push({
          field: 'env',
          message: `Invalid environment variable name: "${key}".`
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Config diff ──────────────────────────────────────────────────────────────

export function diffConfigs(original: VmConfig, updated: VmConfig): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];
  const allKeys = new Set<keyof VmConfig>([
    ...Object.keys(original),
    ...Object.keys(updated)
  ] as (keyof VmConfig)[]);

  for (const key of allKeys) {
    const oldVal = original[key];
    const newVal = updated[key];

    // Deep compare arrays and objects
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs.push({
        field: key,
        oldValue: oldVal,
        newValue: newVal,
        requiresRecreate: RECREATE_REQUIRED_FIELDS.has(key)
      });
    }
  }

  return diffs;
}

export function classifyChanges(diffs: ConfigDiff[]): {
  liveUpdate: ConfigDiff[];
  recreateRequired: ConfigDiff[];
} {
  return {
    liveUpdate: diffs.filter((d) => !d.requiresRecreate),
    recreateRequired: diffs.filter((d) => d.requiresRecreate)
  };
}

// ─── TOML serialization ──────────────────────────────────────────────────────

export function configToToml(config: VmConfig): string {
  const lines: string[] = [];

  // Image section
  if (config.image || config.tag) {
    lines.push('[image]');
    if (config.image) lines.push(`name = "${escapeToml(config.image)}"`);
    if (config.tag) lines.push(`tag = "${escapeToml(config.tag)}"`);
    lines.push('');
  }

  // From
  if (config.from) {
    lines.push(`from = "${escapeToml(config.from)}"`);
    lines.push('');
  }

  // Resources section
  if (config.cpus || config.memory || config.storage || config.overlay) {
    lines.push('[resources]');
    if (config.cpus !== undefined) lines.push(`cpus = ${config.cpus}`);
    if (config.memory !== undefined) lines.push(`memory = ${config.memory}`);
    if (config.storage !== undefined) lines.push(`storage = ${config.storage}`);
    if (config.overlay !== undefined) lines.push(`overlay = ${config.overlay}`);
    lines.push('');
  }

  // GPU section
  if (config.gpu || config.gpuVram) {
    lines.push('[gpu]');
    lines.push(`enabled = ${config.gpu ? 'true' : 'false'}`);
    if (config.gpuVram !== undefined) lines.push(`vram = ${config.gpuVram}`);
    lines.push('');
  }

  // Network section
  if (
    config.net ||
    (config.ports && config.ports.length > 0) ||
    (config.allowHosts && config.allowHosts.length > 0) ||
    (config.allowCidrs && config.allowCidrs.length > 0)
  ) {
    lines.push('[network]');
    if (config.net !== undefined) lines.push(`net = ${config.net ? 'true' : 'false'}`);
    if (config.ports && config.ports.length > 0) {
      lines.push(`ports = [${config.ports.map((p) => `"${p.host}:${p.guest}"`).join(', ')}]`);
    }
    if (config.allowHosts && config.allowHosts.length > 0) {
      lines.push(
        `allow_hosts = [${config.allowHosts.map((h) => `"${escapeToml(h)}"`).join(', ')}]`
      );
    }
    if (config.allowCidrs && config.allowCidrs.length > 0) {
      lines.push(
        `allow_cidrs = [${config.allowCidrs.map((c) => `"${escapeToml(c)}"`).join(', ')}]`
      );
    }
    lines.push('');
  }

  // Volumes section
  if (config.volumes && config.volumes.length > 0) {
    lines.push('[volumes]');
    for (const vol of config.volumes) {
      const suffix = vol.readOnly ? ':ro' : '';
      lines.push(`"${escapeToml(vol.host)}" = "${escapeToml(vol.guest)}${suffix}"`);
    }
    lines.push('');
  }

  // Environment section
  if (config.env && Object.keys(config.env).length > 0) {
    lines.push('[env]');
    for (const [key, value] of Object.entries(config.env)) {
      lines.push(`${key} = "${escapeToml(value)}"`);
    }
    lines.push('');
  }

  // Commands section
  if (
    config.workdir ||
    (config.init && config.init.length > 0) ||
    config.sshAgent !== undefined ||
    config.entrypoint ||
    config.cmd
  ) {
    lines.push('[commands]');
    if (config.workdir) lines.push(`workdir = "${escapeToml(config.workdir)}"`);
    if (config.init && config.init.length > 0) {
      lines.push(`init = [${config.init.map((i) => `"${escapeToml(i)}"`).join(', ')}]`);
    }
    if (config.sshAgent !== undefined)
      lines.push(`ssh_agent = ${config.sshAgent ? 'true' : 'false'}`);
    if (config.entrypoint) lines.push(`entrypoint = "${escapeToml(config.entrypoint)}"`);
    if (config.cmd) lines.push(`cmd = "${escapeToml(config.cmd)}"`);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function escapeToml(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ─── TOML parsing ─────────────────────────────────────────────────────────────

/**
 * Minimal TOML parser for SmolVM config files.
 * Handles the specific structure used by SmolVM Smolfiles.
 * Does NOT use a full TOML library to avoid adding dependencies.
 */
export function parseTomlToConfig(toml: string): { config: VmConfig; errors: ValidationError[] } {
  const config: VmConfig = { name: '' };
  const errors: ValidationError[] = [];
  let currentSection = '';

  const lines = toml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Section header
    const sectionMatch = line.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }

    // Key-value pair: supports both bare keys and quoted keys
    const kvMatch = line.match(/^("(?:[^"\\]|\\.)*"|[\w_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      errors.push({
        field: `line ${lineNum}`,
        message: `Invalid TOML syntax: "${line}"`
      });
      continue;
    }

    let key = kvMatch[1];
    const rawValue = kvMatch[2];
    // Unquote key if it's a quoted string
    if (key.startsWith('"') && key.endsWith('"')) {
      key = key.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    const value = parseTomlValue(rawValue.trim(), errors, lineNum);

    if (value === undefined) continue; // Error already recorded

    switch (currentSection) {
      case 'image':
        if (key === 'name') config.image = String(value);
        else if (key === 'tag') config.tag = String(value);
        break;
      case 'resources':
        if (key === 'cpus') config.cpus = Number(value);
        else if (key === 'memory') config.memory = Number(value);
        else if (key === 'storage') config.storage = Number(value);
        else if (key === 'overlay') config.overlay = Number(value);
        break;
      case 'gpu':
        if (key === 'enabled') config.gpu = Boolean(value);
        else if (key === 'vram') config.gpuVram = Number(value);
        break;
      case 'network':
        if (key === 'net') config.net = Boolean(value);
        else if (key === 'ports') config.ports = parsePortArray(String(value));
        else if (key === 'allow_hosts') config.allowHosts = parseStringArray(String(value));
        else if (key === 'allow_cidrs') config.allowCidrs = parseStringArray(String(value));
        break;
      case 'volumes':
        // volumes are key = value pairs: "/host/path" = "/guest/path[:ro]"
        if (typeof value === 'string') {
          const vol = parseVolumeValue(value);
          if (!config.volumes) config.volumes = [];
          config.volumes.push({ host: key, guest: vol.guest, readOnly: vol.readOnly });
        }
        break;
      case 'env':
        config.env = config.env ?? {};
        config.env[key] = String(value);
        break;
      case 'commands':
        if (key === 'workdir') config.workdir = String(value);
        else if (key === 'init') config.init = parseStringArray(String(value));
        else if (key === 'ssh_agent') config.sshAgent = Boolean(value);
        else if (key === 'entrypoint') config.entrypoint = String(value);
        else if (key === 'cmd') config.cmd = String(value);
        break;
      default:
        // Top-level keys
        if (key === 'from') config.from = String(value);
        else if (key === 'name') config.name = String(value);
        break;
    }
  }

  return { config, errors };
}

function parseTomlValue(raw: string, errors: ValidationError[], lineNum: number): unknown {
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);

  // String (quoted)
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Array
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw; // Return as raw string for array parsing
  }

  errors.push({
    field: `line ${lineNum}`,
    message: `Cannot parse TOML value: "${raw}"`
  });
  return undefined;
}

function parseStringArray(raw: string): string[] {
  if (typeof raw !== 'string' || !raw.startsWith('[') || !raw.endsWith(']')) {
    return [];
  }
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  // Split by comma, parse quoted strings
  const items: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      items.push(current.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"'));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    items.push(current.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"'));
  }
  return items;
}

function parsePortArray(raw: string): VmPortMapping[] {
  const strings = parseStringArray(raw);
  return strings
    .map((s) => {
      const parts = s.split(':');
      if (parts.length === 2) {
        return { host: parseInt(parts[0], 10), guest: parseInt(parts[1], 10) };
      }
      return null;
    })
    .filter((p): p is VmPortMapping => p !== null);
}

function parseVolumeValue(value: string): { guest: string; readOnly?: boolean } {
  const readOnly = value.endsWith(':ro');
  const guestPath = readOnly ? value.slice(0, -3) : value;
  return readOnly ? { guest: guestPath, readOnly: true } : { guest: guestPath };
}

/** Convert VmConfig to SmolVM create request body. */
export function configToCreateRequest(config: VmConfig): Record<string, unknown> {
  const req: Record<string, unknown> = { name: config.name };

  if (config.image) {
    req.image = config.tag ? `${config.image}:${config.tag}` : config.image;
  }
  if (config.from) req.from = config.from;
  if (config.cpus !== undefined) req.cpus = config.cpus;
  if (config.memory !== undefined) req.memoryMb = config.memory;
  if (config.storage !== undefined) req.storageGb = config.storage;
  if (config.overlay !== undefined) req.overlayGb = config.overlay;
  if (config.net !== undefined) req.network = config.net;
  if (config.gpu !== undefined) req.gpu = config.gpu;
  if (config.gpuVram !== undefined) req.gpuVramMb = config.gpuVram;
  if (config.ports && config.ports.length > 0) req.ports = config.ports;
  if (config.volumes && config.volumes.length > 0) {
    req.mounts = config.volumes.map((v) => ({
      source: v.host,
      target: v.guest,
      ...(v.readOnly ? { readonly: true } : {})
    }));
  }
  if (config.env && Object.keys(config.env).length > 0) req.env = config.env;
  if (config.workdir) req.workdir = config.workdir;
  if (config.init && config.init.length > 0) req.init = config.init;
  if (config.sshAgent !== undefined) req.sshAgent = config.sshAgent;
  if (config.allowHosts && config.allowHosts.length > 0) req.allowHosts = config.allowHosts;
  if (config.allowCidrs && config.allowCidrs.length > 0) req.allowCidrs = config.allowCidrs;
  if (config.entrypoint) req.entrypoint = config.entrypoint;
  if (config.cmd) req.cmd = config.cmd;

  return req;
}

/** Convert VmConfig to SmolVM update request body (only live-update fields). */
export function configToUpdateRequest(config: VmConfig): Record<string, unknown> {
  const req: Record<string, unknown> = {};

  if (config.cpus !== undefined) req.cpus = config.cpus;
  if (config.memory !== undefined) req.memoryMb = config.memory;
  if (config.storage !== undefined) req.storageGb = config.storage;
  if (config.overlay !== undefined) req.overlayGb = config.overlay;
  if (config.net !== undefined) req.network = config.net;
  if (config.gpu !== undefined) req.gpu = config.gpu;
  if (config.gpuVram !== undefined) req.gpuVramMb = config.gpuVram;
  if (config.ports && config.ports.length > 0) req.ports = config.ports;
  if (config.volumes && config.volumes.length > 0) {
    req.mounts = config.volumes.map((v) => ({
      source: v.host,
      target: v.guest,
      ...(v.readOnly ? { readonly: true } : {})
    }));
  }
  if (config.env && Object.keys(config.env).length > 0) req.env = config.env;
  if (config.workdir) req.workdir = config.workdir;
  if (config.allowHosts && config.allowHosts.length > 0) req.allowHosts = config.allowHosts;
  if (config.allowCidrs && config.allowCidrs.length > 0) req.allowCidrs = config.allowCidrs;

  return req;
}

/** Parse a SmolVM machine API response into a VmConfig. */
export function machineResponseToConfig(machine: Record<string, unknown>): VmConfig {
  const config: VmConfig = {
    name: String(machine.name ?? '')
  };

  if (typeof machine.cpus === 'number') config.cpus = machine.cpus;
  if (typeof machine.memoryMb === 'number') config.memory = machine.memoryMb;
  if (typeof machine.memory === 'number') config.memory = machine.memory;
  if (typeof machine.storage === 'number') config.storage = machine.storage;
  if (typeof machine.overlay === 'number') config.overlay = machine.overlay;
  if (typeof machine.network === 'boolean') config.net = machine.network;
  if (typeof machine.gpu === 'boolean') config.gpu = machine.gpu;
  if (typeof machine.gpuVram === 'number') config.gpuVram = machine.gpuVram;
  if (typeof machine.image === 'string') {
    const colonIdx = machine.image.lastIndexOf(':');
    if (colonIdx > 0) {
      config.image = machine.image.slice(0, colonIdx);
      config.tag = machine.image.slice(colonIdx + 1);
    } else {
      config.image = machine.image;
    }
  }
  if (typeof machine.workdir === 'string') config.workdir = machine.workdir;
  if (typeof machine.entrypoint === 'string') config.entrypoint = machine.entrypoint;
  if (typeof machine.cmd === 'string') config.cmd = machine.cmd;
  if (typeof machine.sshAgent === 'boolean') config.sshAgent = machine.sshAgent;

  if (Array.isArray(machine.ports)) {
    config.ports = machine.ports.map(
      (p: Record<string, unknown>) =>
        ({
          host: Number(p.host),
          guest: Number(p.guest)
        }) as VmPortMapping
    );
  }

  if (Array.isArray(machine.mounts)) {
    config.volumes = machine.mounts.map(
      (m: Record<string, unknown>) =>
        ({
          host: String(m.host),
          guest: String(m.guest),
          ...(m.readOnly ? { readOnly: true } : {})
        }) as VmVolumeMount
    );
  }

  if (typeof machine.env === 'object' && machine.env !== null && !Array.isArray(machine.env)) {
    config.env = machine.env as Record<string, string>;
  }

  if (Array.isArray(machine.init)) {
    config.init = machine.init.map(String);
  }

  if (Array.isArray(machine.allowHosts)) {
    config.allowHosts = machine.allowHosts.map(String);
  }
  if (Array.isArray(machine.allowCidrs)) {
    config.allowCidrs = machine.allowCidrs.map(String);
  }

  return config;
}

/** Create a copy config with a new name, stripping recreate-required fields. */
export function configForCopy(source: VmConfig, newName: string): VmConfig {
  const copy: VmConfig = { name: newName };

  // Copy all fields except name and recreate-required ones
  if (source.image) copy.image = source.image;
  if (source.tag) copy.tag = source.tag;
  if (source.from) copy.from = source.from;
  if (source.cpus !== undefined) copy.cpus = source.cpus;
  if (source.memory !== undefined) copy.memory = source.memory;
  if (source.storage !== undefined) copy.storage = source.storage;
  if (source.overlay !== undefined) copy.overlay = source.overlay;
  if (source.net !== undefined) copy.net = source.net;
  if (source.gpu !== undefined) copy.gpu = source.gpu;
  if (source.gpuVram !== undefined) copy.gpuVram = source.gpuVram;
  if (source.entrypoint) copy.entrypoint = source.entrypoint;
  if (source.cmd) copy.cmd = source.cmd;
  if (source.workdir) copy.workdir = source.workdir;
  if (source.sshAgent !== undefined) copy.sshAgent = source.sshAgent;

  // Deep copy arrays and objects
  if (source.ports) copy.ports = source.ports.map((p) => ({ ...p }));
  if (source.volumes) copy.volumes = source.volumes.map((v) => ({ ...v }));
  if (source.env) copy.env = { ...source.env };
  if (source.init) copy.init = [...source.init];
  if (source.allowHosts) copy.allowHosts = [...source.allowHosts];
  if (source.allowCidrs) copy.allowCidrs = [...source.allowCidrs];

  return copy;
}

/** Default config for a new VM. */
export function defaultVmConfig(): VmConfig {
  return {
    name: '',
    cpus: 4,
    memory: 8192,
    net: true
  };
}

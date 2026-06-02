import { describe, it, expect } from 'bun:test';
import {
  validateVmConfig,
  configToToml,
  parseTomlToConfig,
  diffConfigs,
  classifyChanges,
  configToCreateRequest,
  configToUpdateRequest,
  machineResponseToConfig,
  configForCopy,
  defaultVmConfig,
  RECREATE_REQUIRED_FIELDS,
  type VmConfig
} from './vm-config';

describe('vm-config: validation', () => {
  it('validates a minimal valid config', () => {
    const result = validateVmConfig({ name: 'test-vm' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a full valid config', () => {
    const result = validateVmConfig({
      name: 'my-vm',
      image: 'alpine',
      tag: 'latest',
      cpus: 2,
      memory: 512,
      storage: 10,
      overlay: 5,
      net: true,
      gpu: true,
      gpuVram: 2048,
      ports: [{ host: 8080, guest: 80 }],
      volumes: [{ host: '/host/path', guest: '/guest/path' }],
      env: { FOO: 'bar' },
      workdir: '/app',
      init: ['echo hello'],
      sshAgent: true,
      allowHosts: ['github.com'],
      allowCidrs: ['10.0.0.0/8']
    });
    expect(result.valid).toBe(true);
  });

  it('rejects empty name', () => {
    const result = validateVmConfig({ name: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('rejects invalid name characters', () => {
    const result = validateVmConfig({ name: 'bad name!' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('rejects cpus out of range', () => {
    const result = validateVmConfig({ name: 'vm', cpus: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'cpus')).toBe(true);
  });

  it('rejects memory below minimum', () => {
    const result = validateVmConfig({ name: 'vm', memory: 32 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'memory')).toBe(true);
  });

  it('rejects invalid port range', () => {
    const result = validateVmConfig({
      name: 'vm',
      ports: [{ host: 0, guest: 80 }]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'ports')).toBe(true);
  });

  it('rejects empty volume paths', () => {
    const result = validateVmConfig({
      name: 'vm',
      volumes: [{ host: '', guest: '/app' }]
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'volumes')).toBe(true);
  });

  it('rejects invalid env key', () => {
    const result = validateVmConfig({
      name: 'vm',
      env: { '123BAD': 'val' }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'env')).toBe(true);
  });
});

describe('vm-config: TOML serialization', () => {
  it('serializes a minimal config', () => {
    const toml = configToToml({ name: 'test-vm' });
    expect(toml).not.toContain('[image]');
    expect(toml).not.toContain('[resources]');
  });

  it('serializes image and tag', () => {
    const toml = configToToml({ name: 'vm', image: 'alpine', tag: '3.18' });
    expect(toml).toContain('[image]');
    expect(toml).toContain('name = "alpine"');
    expect(toml).toContain('tag = "3.18"');
  });

  it('serializes resources', () => {
    const toml = configToToml({ name: 'vm', cpus: 2, memory: 512, storage: 10, overlay: 5 });
    expect(toml).toContain('[resources]');
    expect(toml).toContain('cpus = 2');
    expect(toml).toContain('memory = 512');
    expect(toml).toContain('storage = 10');
    expect(toml).toContain('overlay = 5');
  });

  it('serializes network with ports', () => {
    const toml = configToToml({
      name: 'vm',
      net: true,
      ports: [
        { host: 8080, guest: 80 },
        { host: 3000, guest: 3000 }
      ]
    });
    expect(toml).toContain('[network]');
    expect(toml).toContain('net = true');
    expect(toml).toContain('ports = ["8080:80", "3000:3000"]');
  });

  it('serializes volumes', () => {
    const toml = configToToml({
      name: 'vm',
      volumes: [
        { host: '/host/path', guest: '/guest/path' },
        { host: '/host/ro', guest: '/guest/ro', readOnly: true }
      ]
    });
    expect(toml).toContain('[volumes]');
    expect(toml).toContain('"/host/path" = "/guest/path"');
    expect(toml).toContain('"/host/ro" = "/guest/ro:ro"');
  });

  it('serializes env vars', () => {
    const toml = configToToml({
      name: 'vm',
      env: { FOO: 'bar', BAZ: 'qux' }
    });
    expect(toml).toContain('[env]');
    expect(toml).toContain('FOO = "bar"');
    expect(toml).toContain('BAZ = "qux"');
  });

  it('serializes commands section', () => {
    const toml = configToToml({
      name: 'vm',
      workdir: '/app',
      init: ['echo hello', 'echo world'],
      sshAgent: true,
      entrypoint: '/bin/sh',
      cmd: '-c echo test'
    });
    expect(toml).toContain('[commands]');
    expect(toml).toContain('workdir = "/app"');
    expect(toml).toContain('init = ["echo hello", "echo world"]');
    expect(toml).toContain('ssh_agent = true');
    expect(toml).toContain('entrypoint = "/bin/sh"');
    expect(toml).toContain('cmd = "-c echo test"');
  });

  it('escapes special characters in TOML strings', () => {
    const toml = configToToml({
      name: 'vm',
      env: { PATH_VAR: 'hello "world"' }
    });
    expect(toml).toContain('PATH_VAR = "hello \\"world\\""');
  });
});

describe('vm-config: TOML parsing', () => {
  it('parses a complete TOML config', () => {
    const toml = `[image]
name = "alpine"
tag = "3.18"

[resources]
cpus = 2
memory = 512
storage = 10
overlay = 5

[network]
net = true
ports = ["8080:80", "3000:3000"]
allow_hosts = ["github.com"]
allow_cidrs = ["10.0.0.0/8"]

[volumes]
"/host/path" = "/guest/path"
"/host/ro" = "/guest/ro:ro"

[env]
FOO = "bar"

[commands]
workdir = "/app"
init = ["echo hello", "echo world"]
ssh_agent = true
`;

    const { config, errors } = parseTomlToConfig(toml);
    expect(errors).toHaveLength(0);
    expect(config.image).toBe('alpine');
    expect(config.tag).toBe('3.18');
    expect(config.cpus).toBe(2);
    expect(config.memory).toBe(512);
    expect(config.storage).toBe(10);
    expect(config.overlay).toBe(5);
    expect(config.net).toBe(true);
    expect(config.ports).toEqual([
      { host: 8080, guest: 80 },
      { host: 3000, guest: 3000 }
    ]);
    expect(config.allowHosts).toEqual(['github.com']);
    expect(config.allowCidrs).toEqual(['10.0.0.0/8']);
    expect(config.volumes).toEqual([
      { host: '/host/path', guest: '/guest/path' },
      { host: '/host/ro', guest: '/guest/ro', readOnly: true }
    ]);
    expect(config.env).toEqual({ FOO: 'bar' });
    expect(config.workdir).toBe('/app');
    expect(config.init).toEqual(['echo hello', 'echo world']);
    expect(config.sshAgent).toBe(true);
  });

  it('parses minimal config', () => {
    const toml = `[resources]
cpus = 4
`;
    const { config } = parseTomlToConfig(toml);
    expect(config.cpus).toBe(4);
    expect(config.image).toBeUndefined();
  });

  it('reports parse errors for invalid TOML', () => {
    const toml = `[image]
name = alpine-no-quotes
`;
    const { errors } = parseTomlToConfig(toml);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('round-trips config through TOML serialization and parsing', () => {
    const original: VmConfig = {
      name: 'round-trip',
      image: 'nginx',
      tag: 'latest',
      cpus: 2,
      memory: 1024,
      net: true,
      ports: [{ host: 8080, guest: 80 }],
      volumes: [{ host: '/data', guest: '/app/data' }],
      env: { NODE_ENV: 'production' },
      workdir: '/app',
      init: ['npm start']
    };
    const toml = configToToml(original);
    const { config: parsed } = parseTomlToConfig(toml);

    expect(parsed.image).toBe(original.image);
    expect(parsed.tag).toBe(original.tag);
    expect(parsed.cpus).toBe(original.cpus);
    expect(parsed.memory).toBe(original.memory);
    expect(parsed.net).toBe(original.net);
    expect(parsed.ports).toEqual(original.ports);
    expect(parsed.volumes).toEqual(original.volumes);
    expect(parsed.env).toEqual(original.env);
    expect(parsed.workdir).toBe(original.workdir);
    expect(parsed.init).toEqual(original.init);
  });
});

describe('vm-config: diff and classification', () => {
  it('detects changed fields', () => {
    const original: VmConfig = { name: 'vm', cpus: 2, memory: 512 };
    const updated: VmConfig = { name: 'vm', cpus: 4, memory: 512 };
    const diffs = diffConfigs(original, updated);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe('cpus');
    expect(diffs[0].oldValue).toBe(2);
    expect(diffs[0].newValue).toBe(4);
  });

  it('classifies recreate-required changes', () => {
    const original: VmConfig = { name: 'vm', image: 'alpine', cpus: 2 };
    const updated: VmConfig = { name: 'vm', image: 'nginx', cpus: 4 };
    const diffs = diffConfigs(original, updated);
    const { liveUpdate, recreateRequired } = classifyChanges(diffs);

    expect(recreateRequired.some((d) => d.field === 'image')).toBe(true);
    expect(liveUpdate.some((d) => d.field === 'cpus')).toBe(true);
  });

  it('returns empty diff for identical configs', () => {
    const config: VmConfig = { name: 'vm', cpus: 2 };
    const diffs = diffConfigs(config, { ...config });
    expect(diffs).toHaveLength(0);
  });

  it('RECREATE_REQUIRED_FIELDS includes image, entrypoint, cmd, from, tag', () => {
    expect(RECREATE_REQUIRED_FIELDS.has('image')).toBe(true);
    expect(RECREATE_REQUIRED_FIELDS.has('entrypoint')).toBe(true);
    expect(RECREATE_REQUIRED_FIELDS.has('cmd')).toBe(true);
    expect(RECREATE_REQUIRED_FIELDS.has('from')).toBe(true);
    expect(RECREATE_REQUIRED_FIELDS.has('tag')).toBe(true);
    expect(RECREATE_REQUIRED_FIELDS.has('cpus')).toBe(false);
  });
});

describe('vm-config: API request conversion', () => {
  it('converts config to create request', () => {
    const config: VmConfig = {
      name: 'test-vm',
      image: 'alpine',
      tag: '3.18',
      cpus: 2,
      memory: 512,
      net: true,
      ports: [{ host: 8080, guest: 80 }],
      volumes: [{ host: '/data', guest: '/app/data', readOnly: true }],
      env: { FOO: 'bar' },
      sshAgent: true
    };
    const req = configToCreateRequest(config);
    expect(req.name).toBe('test-vm');
    expect(req.image).toBe('alpine:3.18');
    expect(req.cpus).toBe(2);
    expect(req.memoryMb).toBe(512);
    expect(req.network).toBe(true);
    expect(req.ports).toEqual([{ host: 8080, guest: 80 }]);
    expect(req.mounts).toEqual([{ source: '/data', target: '/app/data', readonly: true }]);
    expect(req.env).toEqual({ FOO: 'bar' });
    expect(req.sshAgent).toBe(true);
  });

  it('converts config to update request (excludes recreate fields)', () => {
    const config: VmConfig = {
      name: 'vm',
      image: 'alpine',
      cpus: 4,
      memory: 1024,
      net: true
    };
    const req = configToUpdateRequest(config);
    expect(req.cpus).toBe(4);
    expect(req.memoryMb).toBe(1024);
    expect(req.network).toBe(true);
    expect('image' in req).toBe(false);
    expect('name' in req).toBe(false);
  });
});

describe('vm-config: machine response to config', () => {
  it('converts SmolVM API response to VmConfig', () => {
    const machine = {
      name: 'test-vm',
      state: 'stopped',
      cpus: 2,
      memoryMb: 512,
      mounts: [{ host: '/data', guest: '/app' }],
      ports: [{ host: 8080, guest: 80 }],
      network: true,
      createdAt: 1234567890
    };
    const config = machineResponseToConfig(machine);
    expect(config.name).toBe('test-vm');
    expect(config.cpus).toBe(2);
    expect(config.memory).toBe(512);
    expect(config.net).toBe(true);
    expect(config.ports).toEqual([{ host: 8080, guest: 80 }]);
    expect(config.volumes).toEqual([{ host: '/data', guest: '/app' }]);
  });

  it('parses image with tag from machine response', () => {
    const machine = {
      name: 'vm',
      state: 'running',
      image: 'alpine:3.18'
    };
    const config = machineResponseToConfig(machine);
    expect(config.image).toBe('alpine');
    expect(config.tag).toBe('3.18');
  });

  it('handles image without tag', () => {
    const machine = {
      name: 'vm',
      state: 'running',
      image: 'nginx'
    };
    const config = machineResponseToConfig(machine);
    expect(config.image).toBe('nginx');
    expect(config.tag).toBeUndefined();
  });
});

describe('vm-config: copy', () => {
  it('creates a copy config with new name', () => {
    const source: VmConfig = {
      name: 'original',
      image: 'alpine',
      tag: '3.18',
      cpus: 2,
      memory: 512,
      net: true,
      ports: [{ host: 8080, guest: 80 }],
      env: { FOO: 'bar' }
    };
    const copy = configForCopy(source, 'copy-vm');
    expect(copy.name).toBe('copy-vm');
    expect(copy.image).toBe('alpine');
    expect(copy.tag).toBe('3.18');
    expect(copy.cpus).toBe(2);
    expect(copy.ports).toEqual([{ host: 8080, guest: 80 }]);
    // Verify deep copy
    copy.ports!.push({ host: 9090, guest: 90 });
    expect(source.ports).toHaveLength(1);
  });
});

describe('vm-config: default config', () => {
  it('returns sensible defaults', () => {
    const config = defaultVmConfig();
    expect(config.name).toBe('');
    expect(config.cpus).toBe(4);
    expect(config.memory).toBe(8192);
    expect(config.net).toBe(true);
  });
});

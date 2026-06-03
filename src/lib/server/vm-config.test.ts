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
import { detectSensitiveHostMounts } from '$lib/sensitive-mounts';

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

  it('sends network (not net) in create request', () => {
    const config: VmConfig = { name: 'net-test', net: true };
    const req = configToCreateRequest(config);
    expect(req.network).toBe(true);
    expect('net' in req).toBe(false);
  });

  it('sends mounts with source/target/readonly (not host/guest/readOnly)', () => {
    const config: VmConfig = {
      name: 'mount-test',
      volumes: [
        { host: '/host/a', guest: '/guest/a' },
        { host: '/host/b', guest: '/guest/b', readOnly: true }
      ]
    };
    const req = configToCreateRequest(config);
    expect(req.mounts).toEqual([
      { source: '/host/a', target: '/guest/a' },
      { source: '/host/b', target: '/guest/b', readonly: true }
    ]);
    expect('volumes' in req).toBe(false);
  });

  it('sends memoryMb/storageGb/overlayGb/gpuVramMb (not memory/storage/overlay/gpuVram)', () => {
    const config: VmConfig = {
      name: 'field-test',
      memory: 1024,
      storage: 20,
      overlay: 10,
      gpuVram: 8192
    };
    const req = configToCreateRequest(config);
    expect(req.memoryMb).toBe(1024);
    expect(req.storageGb).toBe(20);
    expect(req.overlayGb).toBe(10);
    expect(req.gpuVramMb).toBe(8192);
    expect('memory' in req).toBe(false);
    expect('storage' in req).toBe(false);
    expect('overlay' in req).toBe(false);
    expect('gpuVram' in req).toBe(false);
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
      mounts: [{ source: '/data', target: '/app', readonly: true }],
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
    expect(config.volumes).toEqual([{ host: '/data', guest: '/app', readOnly: true }]);
  });

  it('converts SmolVM mounts with source/target/readonly fields', () => {
    const machine = {
      name: 'mount-vm',
      mounts: [
        { source: '/host/path', target: '/guest/path' },
        { source: '/host/ro', target: '/guest/ro', readonly: true }
      ]
    };
    const config = machineResponseToConfig(machine);
    expect(config.volumes).toEqual([
      { host: '/host/path', guest: '/guest/path' },
      { host: '/host/ro', guest: '/guest/ro', readOnly: true }
    ]);
  });

  it('falls back to host/guest/readOnly for legacy mount fields', () => {
    const machine = {
      name: 'legacy-vm',
      mounts: [{ host: '/legacy/host', guest: '/legacy/guest', readOnly: true }]
    };
    const config = machineResponseToConfig(machine);
    expect(config.volumes).toEqual([
      { host: '/legacy/host', guest: '/legacy/guest', readOnly: true }
    ]);
  });

  it('prefers source/target over host/guest when both present', () => {
    const machine = {
      name: 'mixed-vm',
      mounts: [
        { source: '/new/path', target: '/new/guest', host: '/old/path', guest: '/old/guest' }
      ]
    };
    const config = machineResponseToConfig(machine);
    expect(config.volumes![0].host).toBe('/new/path');
    expect(config.volumes![0].guest).toBe('/new/guest');
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

describe('vm-config: sensitive host mount detection', () => {
  it('detects root filesystem mount', () => {
    const warnings = detectSensitiveHostMounts([{ host: '/', guest: '/mnt/root' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toBe('/');
    expect(warnings[0].reason).toContain('Root filesystem');
  });

  it('detects /etc mount', () => {
    const warnings = detectSensitiveHostMounts([{ host: '/etc', guest: '/mnt/etc' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toBe('/etc');
  });

  it('detects /home mount', () => {
    const warnings = detectSensitiveHostMounts([{ host: '/home', guest: '/mnt/home' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('user data');
  });

  it('detects /root mount', () => {
    const warnings = detectSensitiveHostMounts([{ host: '/root', guest: '/mnt/root' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('root user data');
  });

  it('detects Docker socket mount', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/var/run/docker.sock', guest: '/var/run/docker.sock' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('Docker socket');
  });

  it('detects /etc/ssh prefix', () => {
    const warnings = detectSensitiveHostMounts([{ host: '/etc/ssh', guest: '/mnt/ssh' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('SSH server');
  });

  it('detects /etc/ssh subdirectory', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/etc/ssh/sshd_config', guest: '/mnt/sshd' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('SSH server');
  });

  it('detects /root/.ssh prefix', () => {
    const warnings = detectSensitiveHostMounts([{ host: '/root/.ssh', guest: '/mnt/ssh' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('root SSH');
  });

  it('detects /root/.ssh subdirectory', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/root/.ssh/config', guest: '/mnt/ssh-config' }
    ]);
    expect(warnings).toHaveLength(1);
  });

  it('detects /home/<user> prefix', () => {
    const warnings = detectSensitiveHostMounts([{ host: '/home/alice', guest: '/mnt/alice' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('User home directory');
  });

  it('detects id_rsa filename', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/secret/keys/id_rsa', guest: '/mnt/key' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('RSA private key');
  });

  it('detects id_ed25519 filename', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/secret/keys/id_ed25519', guest: '/mnt/key' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('Ed25519');
  });

  it('detects authorized_keys filename', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/secret/keys/authorized_keys', guest: '/mnt/ak' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('Authorized keys');
  });

  it('detects ssh_host key filename outside /etc/ssh', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/backup/ssh_host_ed25519_key', guest: '/mnt/hostkey' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('SSH host key');
  });

  it('detects ssh_host key under /etc/ssh (prefix match takes priority)', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/etc/ssh/ssh_host_ed25519_key', guest: '/mnt/hostkey' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('SSH server');
  });

  it('returns empty for non-sensitive paths', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/data/app', guest: '/app' },
      { host: '/opt/tools', guest: '/tools' },
      { host: '/var/log/app', guest: '/logs' }
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('returns multiple warnings for mixed volumes', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/etc', guest: '/mnt/etc' },
      { host: '/data/app', guest: '/app' },
      { host: '/var/run/docker.sock', guest: '/var/run/docker.sock' }
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0].path).toBe('/etc');
    expect(warnings[1].path).toBe('/var/run/docker.sock');
  });

  it('does not double-warn exact match that also matches prefix', () => {
    const warnings = detectSensitiveHostMounts([{ host: '/etc', guest: '/mnt/etc' }]);
    expect(warnings).toHaveLength(1);
  });

  it('detects id_ecdsa and id_dsa filenames', () => {
    const ecdsa = detectSensitiveHostMounts([{ host: '/secret/keys/id_ecdsa', guest: '/mnt/key' }]);
    expect(ecdsa).toHaveLength(1);
    expect(ecdsa[0].reason).toContain('ECDSA');

    const dsa = detectSensitiveHostMounts([{ host: '/secret/keys/id_dsa', guest: '/mnt/key' }]);
    expect(dsa).toHaveLength(1);
    expect(dsa[0].reason).toContain('DSA');
  });

  it('detects known_hosts filename', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/secret/keys/known_hosts', guest: '/mnt/kh' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('Known hosts');
  });

  it('prefix match takes priority over filename match for /home paths', () => {
    const warnings = detectSensitiveHostMounts([
      { host: '/home/alice/.ssh/id_rsa', guest: '/mnt/key' }
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toContain('User home directory');
  });
});

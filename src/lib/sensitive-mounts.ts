import type { VmVolumeMount } from './types';

const SENSITIVE_EXACT_PATHS: Record<string, string> = {
  '/': 'Root filesystem — exposes the entire host',
  '/etc': 'System configuration directory — exposes host config files',
  '/home': 'Home directories — exposes all user data',
  '/root': 'Root home directory — exposes root user data and credentials',
  '/var/run/docker.sock': 'Docker socket — grants full container host control'
};

const SENSITIVE_PREFIX_PATTERNS: Array<{ prefix: string; reason: string }> = [
  { prefix: '/etc/ssh', reason: 'SSH server configuration — exposes host SSH keys' },
  { prefix: '/root/.ssh', reason: 'Root SSH directory — exposes root SSH keys and config' },
  { prefix: '/home/', reason: 'User home directory — may expose SSH keys and private data' }
];

const SENSITIVE_FILENAME_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\/id_rsa$/, reason: 'RSA private key — exposes host SSH private key' },
  { pattern: /\/id_ed25519$/, reason: 'Ed25519 private key — exposes host SSH private key' },
  { pattern: /\/id_ecdsa$/, reason: 'ECDSA private key — exposes host SSH private key' },
  { pattern: /\/id_dsa$/, reason: 'DSA private key — exposes host SSH private key' },
  { pattern: /\/authorized_keys$/, reason: 'Authorized keys — exposes host SSH access grants' },
  { pattern: /\/known_hosts$/, reason: 'Known hosts — exposes host SSH trust relationships' },
  { pattern: /\/ssh_host_.*_key$/, reason: 'SSH host key — exposes host SSH server private key' }
];

export type SensitiveMountWarning = {
  path: string;
  reason: string;
};

export function detectSensitiveHostMounts(volumes: VmVolumeMount[]): SensitiveMountWarning[] {
  const warnings: SensitiveMountWarning[] = [];
  const flagged = new Set<string>();

  for (const vol of volumes) {
    const hostPath = vol.host;

    if (SENSITIVE_EXACT_PATHS[hostPath]) {
      warnings.push({ path: hostPath, reason: SENSITIVE_EXACT_PATHS[hostPath] });
      flagged.add(hostPath);
      continue;
    }

    let matched = false;
    for (const { prefix, reason } of SENSITIVE_PREFIX_PATTERNS) {
      if (
        hostPath === prefix ||
        hostPath.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')
      ) {
        warnings.push({ path: hostPath, reason });
        flagged.add(hostPath);
        matched = true;
        break;
      }
    }

    if (matched) continue;

    for (const { pattern, reason } of SENSITIVE_FILENAME_PATTERNS) {
      if (pattern.test(hostPath)) {
        warnings.push({ path: hostPath, reason });
        flagged.add(hostPath);
        break;
      }
    }
  }

  return warnings;
}

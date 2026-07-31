import { describe, expect, it } from 'bun:test';
import {
  fieldChangeRequiresRecreate,
  LIVE_UPDATABLE_FIELDS,
  RECREATE_REQUIRED_FIELDS
} from './vm-update-policy';

describe('vm-update-policy', () => {
  it('marks all smolvm machine update fields as live-updatable', () => {
    for (const field of ['cpus', 'memory', 'storage', 'overlay', 'net', 'gpu', 'ports', 'volumes', 'env', 'workdir']) {
      expect(LIVE_UPDATABLE_FIELDS.has(field)).toBe(true);
      expect(fieldChangeRequiresRecreate(field)).toBe(false);
    }
  });

  it('keeps image-defining fields in RECREATE_REQUIRED_FIELDS', () => {
    for (const field of ['image', 'tag', 'from', 'entrypoint', 'cmd']) {
      expect(RECREATE_REQUIRED_FIELDS.has(field)).toBe(true);
      expect(fieldChangeRequiresRecreate(field)).toBe(true);
    }
  });

  it('requires recreation for egress and other create-only fields', () => {
    for (const field of ['allowHosts', 'allowCidrs', 'dns', 'gpuVram', 'dockerSocket', 'restart', 'secrets', 'registryIdentityToken', 'init', 'sshAgent']) {
      expect(fieldChangeRequiresRecreate(field)).toBe(true);
    }
  });

  it('never treats the machine name as a config change', () => {
    expect(fieldChangeRequiresRecreate('name')).toBe(false);
  });
});
